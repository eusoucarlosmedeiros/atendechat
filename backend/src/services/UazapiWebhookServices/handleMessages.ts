import path from "path";
import fs from "fs";
import axios from "axios";
import { promisify } from "util";
import { writeFile } from "fs";
import { extension as mimeExtension } from "mime-types";
import * as Sentry from "@sentry/node";

import Whatsapp from "../../models/Whatsapp";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import Company from "../../models/Company";

import CreateMessageService from "../MessageServices/CreateMessageService";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import ShowQueueIntegrationService from "../QueueIntegrationServices/ShowQueueIntegrationService";
import typebotListener from "../TypebotServices/typebotListener";
import { logger } from "../../utils/logger";
import formatBody from "../../helpers/Mustache";

const writeFileAsync = promisify(writeFile);
const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

/**
 * UazapiMessagePayload — formato esperado do payload "messages" da uazapi.
 *
 * Campos podem variar entre versoes; mantemos `[key: string]: any` para
 * tolerar campos extras. O TypeScript aqui e indicativo, nao exclusivo.
 */
interface UazapiMessagePayload {
  id: string;
  event?: string;
  from?: string;          // <pn>@s.whatsapp.net OU <pn> OU <lid>@lid
  to?: string;
  from_me?: boolean;
  fromMe?: boolean;
  isGroup?: boolean;
  groupId?: string;
  participant?: string;   // sender em grupo
  pushName?: string;

  // Identificadores adicionais expostos pela uazapi
  wa_senderJid?: string;  // PN normalizado (preferencial)
  sender_lid?: string;    // LID quando aplicavel
  senderLid?: string;
  senderJid?: string;

  text?: string;
  caption?: string;
  body?: string;
  messageType?: string;   // conversation | image | video | audio | ptt | document | sticker | location | contact | list | button | reaction
  type?: string;

  // Midia
  media_url?: string;
  mediaUrl?: string;
  mimetype?: string;
  fileName?: string;
  filename?: string;

  // Metadados
  timestamp?: number;
  status?: string;
  reply_id?: string;
  replyId?: string;

  [key: string]: any;
}

/**
 * Normaliza um evento "messages" da uazapi para o formato que o restante
 * do handler espera. A uazapi entrega payload com campos em PascalCase
 * (Chat, Sender, IsFromMe, IsGroup, Body, MessageID, etc) — convertemos
 * para snake_case/camelCase preservando o objeto original em [_raw].
 *
 * Tolera tambem providers que entregam campos em camelCase ou snake_case
 * direto (sem o envelope event).
 */
const normalizeMessage = (raw: any): UazapiMessagePayload => {
  if (!raw || typeof raw !== "object") {
    return { id: "" } as UazapiMessagePayload;
  }
  const Info = raw.Info || {};
  const MessageContent = raw.Message || {};

  const id =
    raw.id ||
    raw.MessageID ||
    raw.messageId ||
    raw.message_id ||
    Info.ID ||
    Info.Id ||
    Info.id ||
    "";

  const text =
    raw.text ||
    raw.Body ||
    raw.body ||
    raw.Text ||
    raw.Conversation ||
    raw.conversation ||
    MessageContent.Conversation ||
    MessageContent.ExtendedTextMessage?.Text ||
    MessageContent.extendedTextMessage?.text ||
    "";

  const messageType =
    raw.messageType ||
    raw.MessageType ||
    raw.type ||
    raw.Type ||
    (MessageContent.ImageMessage || MessageContent.imageMessage ? "image" :
     MessageContent.VideoMessage || MessageContent.videoMessage ? "video" :
     MessageContent.AudioMessage || MessageContent.audioMessage ? "audio" :
     MessageContent.DocumentMessage || MessageContent.documentMessage ? "document" :
     MessageContent.StickerMessage || MessageContent.stickerMessage ? "sticker" :
     MessageContent.Conversation || MessageContent.conversation ? "conversation" :
     "conversation");

  const fromMe = raw.from_me ?? raw.fromMe ?? raw.IsFromMe ?? Info.IsFromMe ?? false;
  const isGroup = raw.isGroup ?? raw.IsGroup ?? Info.IsGroup ?? false;

  return {
    id: String(id),
    from: raw.from || raw.Chat || raw.chatid || Info.Chat || Info.RemoteJid || "",
    to: raw.to || "",
    from_me: !!fromMe,
    fromMe: !!fromMe,
    isGroup: !!isGroup,
    groupId: raw.groupId || (isGroup ? (raw.Chat || raw.chatid) : undefined),
    participant: raw.participant || raw.Sender || raw.sender_pn || Info.Sender,
    pushName: raw.pushName || raw.PushName || Info.PushName,
    wa_senderJid: raw.wa_senderJid || raw.sender_pn || raw.Sender || Info.Sender,
    sender_lid: raw.sender_lid || raw.senderLid || raw.SenderLid,
    senderJid: raw.senderJid || raw.wa_senderJid,
    senderLid: raw.senderLid || raw.sender_lid,
    text: typeof text === "string" ? text : "",
    caption: raw.caption || raw.Caption,
    body: raw.body || text,
    messageType,
    type: messageType,
    media_url: raw.media_url || raw.mediaUrl || raw.MediaURL || raw.URL,
    mediaUrl: raw.mediaUrl || raw.media_url,
    mimetype: raw.mimetype || raw.Mimetype || raw.mime_type,
    fileName: raw.fileName || raw.FileName || raw.filename,
    timestamp: raw.timestamp || raw.Timestamp || Info.Timestamp,
    status: raw.status || raw.Status,
    reply_id: raw.reply_id || raw.replyId || raw.ReplyID,
    ...raw // preserva campos originais para debug/futuro
  };
};

/**
 * Determina se a mensagem deve ser ignorada antes do processamento pesado.
 */
const shouldFilter = (msg: UazapiMessagePayload): boolean => {
  // Mensagens de status broadcast (vista 24h)
  const remote = msg.from || msg.to || "";
  if (typeof remote === "string" && remote.includes("status@broadcast")) {
    return true;
  }
  return false;
};

/**
 * Resolve o telefone (PN limpo) e o LID a partir dos varios campos
 * possiveis no payload uazapi.
 */
const resolveContactIdentifiers = (
  msg: UazapiMessagePayload
): { pn: string; lid?: string; jidRaw: string } => {
  // Para grupos, o "remetente" real e o participant. Para 1:1, e o `from`.
  const isGroup = !!msg.isGroup || /(@g\.us)$/.test(msg.from || "");

  const senderRaw = isGroup
    ? msg.participant || msg.wa_senderJid || msg.from
    : msg.wa_senderJid || msg.from;

  const jidRaw = String(senderRaw || msg.from || "");

  // PN: preferimos wa_senderJid (que ja vem normalizado pela uazapi).
  const pnSource = msg.wa_senderJid || jidRaw;
  const pn = pnSource.endsWith("@s.whatsapp.net")
    ? pnSource.split("@")[0]
    : pnSource.endsWith("@lid")
    ? "" // se so temos LID, deixamos pn vazio — uazapi resolve depois
    : pnSource.replace(/\D/g, "");

  const lid = (msg.sender_lid || msg.senderLid || "").replace(/\D/g, "") || undefined;

  return { pn, lid, jidRaw };
};

/**
 * Resolve o JID do "chat" (1:1: pn@s.whatsapp.net | grupo: id@g.us).
 */
const resolveChatJid = (msg: UazapiMessagePayload): string => {
  const fromRaw = msg.from || "";
  if (msg.isGroup || fromRaw.endsWith("@g.us")) {
    if (fromRaw.endsWith("@g.us")) return fromRaw;
    if (msg.groupId) {
      return msg.groupId.endsWith("@g.us") ? msg.groupId : `${msg.groupId}@g.us`;
    }
  }
  return fromRaw;
};

/**
 * Cria ou atualiza o Contact a partir do payload.
 */
const verifyUazapiContact = async (
  msg: UazapiMessagePayload,
  whatsapp: Whatsapp
): Promise<Contact> => {
  const { pn, lid } = resolveContactIdentifiers(msg);
  const isGroup = !!msg.isGroup || /(@g\.us)$/.test(msg.from || "");

  // Para grupo, persistimos o "contato grupo" (number = groupId, isGroup=true).
  if (isGroup) {
    const chatJid = resolveChatJid(msg);
    const groupNumber = chatJid.endsWith("@g.us")
      ? chatJid.slice(0, -"@g.us".length)
      : chatJid.replace(/\D/g, "");
    return CreateOrUpdateContactService({
      name: msg.pushName || groupNumber,
      number: groupNumber,
      isGroup: true,
      profilePicUrl: msg.profilePicUrl,
      companyId: whatsapp.companyId,
      whatsappId: whatsapp.id
    });
  }

  // 1:1 — preferimos PN como number; lid em coluna separada.
  const number = pn || (lid ? lid : "");
  if (!number) {
    throw new Error(
      `[uazapi] handleMessages: nao consegui derivar number/lid do payload`
    );
  }
  return CreateOrUpdateContactService({
    name: msg.pushName || number,
    number,
    isGroup: false,
    profilePicUrl: msg.profilePicUrl,
    companyId: whatsapp.companyId,
    whatsappId: whatsapp.id,
    lid
  });
};

/**
 * Para grupos: tambem cria/atualiza o contato do REMETENTE individual
 * dentro do grupo (necessario pra atribuir mensagem a participante certo).
 */
const verifyGroupSenderContact = async (
  msg: UazapiMessagePayload,
  whatsapp: Whatsapp
): Promise<Contact | null> => {
  if (!msg.isGroup) return null;
  const { pn, lid } = resolveContactIdentifiers(msg);
  const number = pn || lid || "";
  if (!number) return null;
  return CreateOrUpdateContactService({
    name: msg.pushName || number,
    number,
    isGroup: false,
    companyId: whatsapp.companyId,
    whatsappId: whatsapp.id,
    lid
  });
};

/**
 * Determina o body textual da mensagem para exibicao na UI.
 */
const getMessageBody = (msg: UazapiMessagePayload): string => {
  return (
    msg.text ||
    msg.body ||
    msg.caption ||
    (msg.messageType === "audio" || msg.messageType === "ptt"
      ? "Áudio"
      : msg.messageType === "image"
      ? "Imagem"
      : msg.messageType === "video"
      ? "Vídeo"
      : msg.messageType === "document"
      ? "Documento"
      : msg.messageType === "sticker"
      ? "Sticker"
      : msg.messageType === "location"
      ? "Localização"
      : msg.messageType === "contact"
      ? "Contato"
      : "")
  );
};

/**
 * Determina o "mediaType" salvo em Message para compatibilidade com a UI
 * existente (que espera labels como "image", "video", "audio", etc).
 */
const getMediaType = (msg: UazapiMessagePayload): string => {
  const t = (msg.messageType || msg.type || "").toLowerCase();
  if (["image", "video", "audio", "ptt", "document", "sticker"].includes(t)) {
    return t === "ptt" ? "audio" : t;
  }
  if (t === "location") return "location";
  if (t === "contact" || t === "vcard") return "contact";
  if (t === "conversation" || t === "text" || t === "extendedtextmessage") {
    return "conversation";
  }
  return t || "conversation";
};

/**
 * Baixa o arquivo de midia (se houver) e salva em /public.
 * Retorna o nome do arquivo salvo ou undefined se nao houver midia.
 */
const downloadAndSaveMedia = async (
  msg: UazapiMessagePayload
): Promise<string | undefined> => {
  const url = msg.media_url || msg.mediaUrl;
  if (!url) return undefined;

  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000
    });
    const buffer = Buffer.from(response.data);

    let filename = msg.fileName || msg.filename || "";
    if (!filename) {
      const mt = msg.mimetype || response.headers["content-type"] || "";
      const ext = mimeExtension(mt as string) || "bin";
      filename = `${Date.now()}.${ext}`;
    } else {
      filename = `${Date.now()}_${filename}`;
    }

    const targetPath = path.join(publicFolder, filename);
    await writeFileAsync(targetPath, buffer);
    return filename;
  } catch (err) {
    logger.warn(`[uazapi] falha ao baixar media ${url}: ${err}`);
    return undefined;
  }
};

/**
 * Handler principal — recebe um evento `messages` da uazapi e persiste
 * Contact + Ticket + Message, propagando via socket.io para o frontend.
 *
 * Migrado da logica de wbotMessageListener.handleMessage (Baileys),
 * adaptado para o payload da uazapi e simplificado: cobre os casos
 * essenciais (texto, midia comum). Casos exoticos (list, button,
 * location, contact card) sao persistidos com mediaType bruto e podem
 * exigir polish em iteracoes futuras.
 */
const handleMessages = async (
  payload: any,
  whatsapp: Whatsapp
): Promise<void> => {
  // Payload pode vir como:
  //   - objeto unico (envelope ja desempacotado pelo router)
  //   - array de mensagens
  //   - { messages: [...] } (raro)
  const rawList: any[] = Array.isArray(payload?.messages)
    ? payload.messages
    : Array.isArray(payload)
    ? payload
    : [payload];

  const messages: UazapiMessagePayload[] = rawList
    .filter(r => r && typeof r === "object")
    .map(normalizeMessage);

  for (const msg of messages) {
    if (!msg.id) {
      logger.warn(
        `[uazapi] handleMessages: payload sem id wid=${whatsapp.id} ` +
        `payload=${JSON.stringify(msg).slice(0, 500)}`
      );
      continue;
    }
    if (shouldFilter(msg)) continue;

    try {
      await processSingleMessage(msg, whatsapp);
      logger.info(
        `[uazapi] handleMessages persistido msg=${msg.id} from=${msg.from} fromMe=${msg.from_me} wid=${whatsapp.id}`
      );
    } catch (err: any) {
      Sentry.captureException(err, {
        tags: { source: "handleMessages", whatsappId: whatsapp.id, msgId: msg.id }
      });
      logger.error(
        `[uazapi] handleMessages erro msg=${msg.id} wid=${whatsapp.id}: ${err?.message || err}`
      );
    }
  }
};

const processSingleMessage = async (
  msg: UazapiMessagePayload,
  whatsapp: Whatsapp
): Promise<void> => {
  const fromMe = msg.from_me === true || msg.fromMe === true;

  // Idempotencia adicional ao nivel de Message (alem do WebhookEvents
  // que e nivel de evento bruto): se ja existe Message com esse id, skip.
  const existing = await Message.count({
    where: { id: msg.id, companyId: whatsapp.companyId }
  });
  if (existing > 0) return;

  const contact = await verifyUazapiContact(msg, whatsapp);
  const groupSender = await verifyGroupSenderContact(msg, whatsapp);

  const ticket = await FindOrCreateTicketService(
    groupSender || contact,
    whatsapp.id,
    fromMe ? 0 : 1,
    whatsapp.companyId,
    msg.isGroup ? contact : undefined
  );

  let mediaUrl: string | undefined;
  const mediaType = getMediaType(msg);
  const isMedia = ["image", "video", "audio", "document", "sticker"].includes(mediaType);
  if (isMedia) {
    mediaUrl = await downloadAndSaveMedia(msg);
  }

  const body = getMessageBody(msg);

  // wa_senderJid e sender_lid persistidos diretamente nas colunas novas
  const senderJid = msg.wa_senderJid || msg.senderJid;
  const senderLid = msg.sender_lid || msg.senderLid;

  const messageData = {
    id: msg.id,
    ticketId: ticket.id,
    contactId: fromMe ? undefined : (groupSender || contact).id,
    body: body || (mediaUrl ? "[mídia]" : "-"),
    fromMe,
    read: fromMe,
    mediaUrl,
    mediaType,
    quotedMsgId: msg.reply_id || msg.replyId || undefined,
    ack: 0,
    remoteJid: resolveChatJid(msg),
    participant: msg.participant,
    senderJid,
    senderLid,
    dataJson: JSON.stringify(msg)
  };

  await ticket.update({ lastMessage: body || "[mídia]" });

  await CreateMessageService({
    messageData: messageData as any,
    companyId: whatsapp.companyId
  });

  // Integracao Typebot — somente para mensagens recebidas (nao fromMe) em
  // tickets que tem useIntegration ativa.
  if (!fromMe && ticket.useIntegration && ticket.integrationId) {
    try {
      const integration = await ShowQueueIntegrationService(
        ticket.integrationId,
        whatsapp.companyId
      );
      if (integration && integration.type === "typebot") {
        await typebotListener({
          whatsapp,
          remoteJid: resolveChatJid(msg),
          body,
          pushName: msg.pushName,
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
