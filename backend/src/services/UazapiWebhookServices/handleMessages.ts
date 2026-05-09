import path from "path";
import fs from "fs";
import axios from "axios";
import { promisify } from "util";
import { writeFile } from "fs";
import { extension as mimeExtension } from "mime-types";
import * as Sentry from "@sentry/node";

import Whatsapp from "../../models/Whatsapp";
import Contact from "../../models/Contact";
import Message from "../../models/Message";

import CreateMessageService from "../MessageServices/CreateMessageService";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import ShowQueueIntegrationService from "../QueueIntegrationServices/ShowQueueIntegrationService";
import typebotListener from "../TypebotServices/typebotListener";
import { logger } from "../../utils/logger";

const writeFileAsync = promisify(writeFile);
const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

/**
 * Schema Chat conforme uazapi-openapi-spec.yaml (linhas 249-487).
 * Mantido como Partial<any> + indexed access para tolerar campos extras
 * que a uazapi possa adicionar.
 */
interface UazapiChat {
  id?: string;                  // ID interno uazapi (r + hex)
  wa_chatid?: string;           // JID completo: <num>@s.whatsapp.net | <id>@g.us
  wa_chatlid?: string;          // LID quando aplicavel
  wa_contactName?: string;
  wa_name?: string;
  name?: string;
  image?: string;
  imagePreview?: string;
  wa_isGroup?: boolean;
  phone?: string;
  wa_unreadCount?: number;
  [k: string]: any;
}

/**
 * Schema Message conforme uazapi-openapi-spec.yaml (linhas 488-648).
 */
interface UazapiMessage {
  id?: string;                  // ID interno uazapi
  messageid?: string;           // ID original WhatsApp (idempotencia!)
  chatid?: string;              // referencia ao chat.id interno
  sender?: string;              // ID interno do remetente
  senderName?: string;
  isGroup?: boolean;
  fromMe?: boolean;
  messageType?: string;         // conversation | image | video | audio | ptt | document | sticker | location | contact | reaction
  messageTimestamp?: number;
  status?: string;
  text?: string;
  quoted?: string;              // ID da msg citada
  edited?: string;
  reaction?: string;
  fileURL?: string;             // URL da midia
  wasSentByApi?: boolean;       // filtramos quando true (evita loop)
  sender_pn?: string;           // PN resolvido
  sender_lid?: string;          // LID original
  content?: any;                // conteudo bruto
  [k: string]: any;
}

interface UazapiMessageEnvelope {
  BaseUrl?: string;
  EventType?: string;
  chat?: UazapiChat;
  message?: UazapiMessage;
  instanceName?: string;
  owner?: string;
  token?: string;
  [k: string]: any;
}

/**
 * Extrai PN limpo (so digitos) do JID do chat.
 *   "5511999999999@s.whatsapp.net" -> "5511999999999"
 *   "120363xxx@g.us"               -> "120363xxx"
 */
const jidToNumber = (jid?: string): string => {
  if (!jid) return "";
  const at = jid.indexOf("@");
  return (at >= 0 ? jid.slice(0, at) : jid).replace(/\D/g, "");
};

/**
 * Determina se a mensagem deve ser ignorada antes do processamento.
 */
const shouldFilter = (msg: UazapiMessage, chat: UazapiChat): boolean => {
  // Mensagens vindas da nossa propria API (loop guard).
  if (msg.wasSentByApi) return true;
  // Status broadcast (vista 24h)
  const jid = chat.wa_chatid || "";
  if (jid.includes("status@broadcast")) return true;
  return false;
};

/**
 * Mapeia messageType da uazapi -> mediaType armazenado em Messages.
 * Mantem compatibilidade com o que o frontend espera.
 */
const mapMediaType = (msg: UazapiMessage): string => {
  const t = (msg.messageType || "").toLowerCase();
  if (t === "ptt") return "audio"; // voice notes salvas como "audio"
  if (["image", "video", "audio", "document", "sticker", "location", "contact"].includes(t)) {
    return t;
  }
  return "conversation";
};

/**
 * Body textual para exibicao na UI.
 */
const getMessageBody = (msg: UazapiMessage): string => {
  if (msg.text) return msg.text;
  const t = (msg.messageType || "").toLowerCase();
  if (t === "image") return "Imagem";
  if (t === "video") return "Vídeo";
  if (t === "audio" || t === "ptt") return "Áudio";
  if (t === "document") return "Documento";
  if (t === "sticker") return "Sticker";
  if (t === "location") return "Localização";
  if (t === "contact") return "Contato";
  if (t === "reaction") return msg.text || "reaction";
  return "";
};

/**
 * Baixa o arquivo de midia a partir de Message.fileURL (uazapi).
 * Retorna o nome do arquivo salvo em /public ou undefined.
 */
const downloadAndSaveMedia = async (
  msg: UazapiMessage
): Promise<string | undefined> => {
  if (!msg.fileURL) return undefined;
  try {
    const response = await axios.get(msg.fileURL, {
      responseType: "arraybuffer",
      timeout: 30000
    });
    const buffer = Buffer.from(response.data);

    const contentType = (response.headers["content-type"] as string) || "";
    const ext = mimeExtension(contentType) || "bin";
    const filename = `${Date.now()}.${ext}`;

    const targetPath = path.join(publicFolder, filename);
    await writeFileAsync(targetPath, buffer);
    return filename;
  } catch (err) {
    logger.warn(`[uazapi] falha ao baixar media ${msg.fileURL}: ${err}`);
    return undefined;
  }
};

/**
 * Handler do evento `messages` da uazapi.
 *
 * Recebe envelope completo (chat + message). Persiste Contact, Ticket e
 * Message no banco e propaga via socket.io para o frontend.
 */
const handleMessages = async (
  payload: any,
  whatsapp: Whatsapp
): Promise<void> => {
  const env = (payload || {}) as UazapiMessageEnvelope;
  const chat = env.chat;
  const msg = env.message;

  if (!chat || !msg) {
    logger.warn(
      `[uazapi] handleMessages: payload sem chat ou message wid=${whatsapp.id} ` +
      `keys=${Object.keys(payload || {}).join(",")} payload=${JSON.stringify(payload).slice(0, 800)}`
    );
    return;
  }

  if (shouldFilter(msg, chat)) return;

  const messageId = msg.messageid || msg.id;
  if (!messageId) {
    logger.warn(
      `[uazapi] handleMessages: message sem id wid=${whatsapp.id} ` +
      `payload=${JSON.stringify(msg).slice(0, 600)}`
    );
    return;
  }

  // Idempotencia ao nivel de Message (alem do WebhookEvents)
  const existing = await Message.count({
    where: { id: String(messageId), companyId: whatsapp.companyId }
  });
  if (existing > 0) return;

  try {
    await processSingleMessage(env, chat, msg, whatsapp, String(messageId));
    logger.info(
      `[uazapi] msg=${messageId} chat=${chat.wa_chatid} fromMe=${!!msg.fromMe} type=${msg.messageType} text="${(msg.text || "").slice(0, 80)}" wid=${whatsapp.id} OK`
    );
  } catch (err: any) {
    Sentry.captureException(err, {
      tags: { source: "handleMessages", whatsappId: whatsapp.id, msgId: messageId }
    });
    logger.error(
      `[uazapi] handleMessages erro msg=${messageId} wid=${whatsapp.id}: ${err?.message || err}`
    );
  }
};

const processSingleMessage = async (
  env: UazapiMessageEnvelope,
  chat: UazapiChat,
  msg: UazapiMessage,
  whatsapp: Whatsapp,
  messageId: string
): Promise<void> => {
  const isGroup = !!(msg.isGroup || chat.wa_isGroup);
  const fromMe = !!msg.fromMe;
  const chatJid = chat.wa_chatid || "";

  // Contact: para 1:1, e o proprio chat. Para grupo, criamos
  // um Contact "fake" do grupo (number = groupId, isGroup=true) e
  // resolvemos o sender separado.
  let contact: Contact;
  let groupSender: Contact | null = null;

  if (isGroup) {
    const groupNumber = jidToNumber(chatJid);
    contact = await CreateOrUpdateContactService({
      name: chat.name || chat.wa_name || chat.wa_contactName || groupNumber,
      number: groupNumber,
      isGroup: true,
      profilePicUrl: chat.image || undefined,
      companyId: whatsapp.companyId,
      whatsappId: whatsapp.id
    });

    // Sender individual: prefere sender_pn (PN resolvido) e usa sender_lid
    // como fallback. msg.sender (ID interno uazapi) nao serve aqui.
    const senderJid = msg.sender_pn || msg.sender || msg.sender_lid || "";
    const senderNumber = jidToNumber(senderJid);
    if (senderNumber) {
      groupSender = await CreateOrUpdateContactService({
        name: msg.senderName || senderNumber,
        number: senderNumber,
        isGroup: false,
        companyId: whatsapp.companyId,
        whatsappId: whatsapp.id,
        lid: msg.sender_lid ? jidToNumber(msg.sender_lid) : undefined
      });
    }
  } else {
    // 1:1 — usa sender_pn (PN resolvido) se disponivel; cai pro JID do chat.
    const number = jidToNumber(chat.phone || msg.sender_pn || chatJid);
    contact = await CreateOrUpdateContactService({
      name: msg.senderName || chat.name || chat.wa_name || chat.wa_contactName || number,
      number,
      isGroup: false,
      profilePicUrl: chat.image || undefined,
      companyId: whatsapp.companyId,
      whatsappId: whatsapp.id,
      lid: msg.sender_lid
        ? jidToNumber(msg.sender_lid)
        : chat.wa_chatlid
        ? jidToNumber(chat.wa_chatlid)
        : undefined
    });
  }

  // Ticket
  const ticket = await FindOrCreateTicketService(
    groupSender || contact,
    whatsapp.id,
    fromMe ? 0 : 1,
    whatsapp.companyId,
    isGroup ? contact : undefined
  );

  // Midia
  const mediaType = mapMediaType(msg);
  const isMedia = ["image", "video", "audio", "document", "sticker"].includes(mediaType);
  let mediaUrl: string | undefined;
  if (isMedia) {
    mediaUrl = await downloadAndSaveMedia(msg);
  }

  const body = getMessageBody(msg) || (mediaUrl ? "[mídia]" : "-");

  const messageData = {
    id: messageId,
    ticketId: ticket.id,
    contactId: fromMe ? undefined : (groupSender || contact).id,
    body,
    fromMe,
    read: fromMe,
    mediaUrl,
    mediaType,
    quotedMsgId: msg.quoted || undefined,
    ack: 0,
    remoteJid: chatJid,
    participant: msg.sender_pn || msg.sender,
    senderJid: msg.sender_pn,
    senderLid: msg.sender_lid,
    dataJson: JSON.stringify(env)
  };

  await ticket.update({ lastMessage: body });

  await CreateMessageService({
    messageData: messageData as any,
    companyId: whatsapp.companyId
  });

  // Integracao Typebot (somente mensagens recebidas em ticket com
  // useIntegration ativa)
  if (!fromMe && ticket.useIntegration && ticket.integrationId) {
    try {
      const integration = await ShowQueueIntegrationService(
        ticket.integrationId,
        whatsapp.companyId
      );
      if (integration && integration.type === "typebot") {
        await typebotListener({
          whatsapp,
          remoteJid: chatJid,
          body: msg.text || "",
          pushName: msg.senderName,
          ticket,
          typebot: integration
        });
      }
    } catch (err) {
      logger.warn(`[uazapi] typebot listener falhou ticket=${ticket.id}: ${err}`);
    }
  }
};

export default handleMessages;
