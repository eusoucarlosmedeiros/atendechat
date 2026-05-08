import Whatsapp from "../../models/Whatsapp";
import Setting from "../../models/Setting";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Company from "../../models/Company";
import CreateMessageService from "../MessageServices/CreateMessageService";
import SendText from "../UazapiServices/send/SendText";
import { logger } from "../../utils/logger";

/**
 * Handler do evento `call` — chamada de voz/video recebida.
 *
 * Migrado de wbotMonitor.ts (Baileys) — quando o admin configurou
 * Setting key=call value=disabled, envia mensagem automatica em pt/en/es
 * conforme idioma da company, e cria registro `call_log` no ticket.
 */

const TRANSLATED_MSG: Record<string, string> = {
  pt: "*Mensagem Automática:*\n\nAs chamadas de voz e vídeo estão desabilitadas para esse WhatsApp, favor enviar uma mensagem de texto. Obrigado",
  en: "*Automatic Message:*\n\nVoice and video calls are disabled for this WhatsApp, please send a text message. Thank you",
  es: "*Mensaje Automático:*\n\nLas llamadas de voz y video están deshabilitadas para este WhatsApp, por favor envía un mensaje de texto. Gracias"
};

const handleCall = async (payload: any, whatsapp: Whatsapp): Promise<void> => {
  const callType: string = (payload.action || payload.tag || payload.callType || "")
    .toString()
    .toLowerCase();

  // So nos interessa "terminate" (chamada finalizada) — equivalente ao
  // CB:call.terminate da Baileys.
  if (callType !== "terminate" && callType !== "missed" && callType !== "ended") {
    return;
  }

  const fromNumber: string = (payload.from || payload.caller || "").toString();
  if (!fromNumber) {
    logger.warn(`[uazapi] call sem caller (wid=${whatsapp.id})`);
    return;
  }

  // Setting de bloqueio de calls
  const sendMsgCall = await Setting.findOne({
    where: { key: "call", companyId: whatsapp.companyId }
  });
  if (!sendMsgCall || sendMsgCall.value !== "disabled") return;

  const company = await Company.findByPk(whatsapp.companyId);
  const lang = (company?.language as string) || "pt";
  const text = TRANSLATED_MSG[lang] || TRANSLATED_MSG.pt;

  // Envia mensagem automatica via uazapi
  try {
    await SendText(whatsapp, { number: fromNumber, text });
  } catch (err) {
    logger.warn(`[uazapi] falha ao enviar msg automatica de call: ${err}`);
  }

  // Persiste call_log no ticket existente
  const cleanNumber = fromNumber.replace(/\D/g, "");
  const contact = await Contact.findOne({
    where: { companyId: whatsapp.companyId, number: cleanNumber }
  });
  if (!contact) return;

  const ticket = await Ticket.findOne({
    where: {
      contactId: contact.id,
      whatsappId: whatsapp.id,
      companyId: whatsapp.companyId
    }
  });
  if (!ticket) return;

  const date = new Date();
  const body = `Chamada de voz/vídeo perdida às ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;

  const messageData = {
    id: payload.callId || payload.id || `call-${Date.now()}`,
    ticketId: ticket.id,
    contactId: contact.id,
    body,
    fromMe: false,
    mediaType: "call_log",
    read: true,
    quotedMsgId: null,
    ack: 1
  };

  await ticket.update({ lastMessage: body });
  if (ticket.status === "closed") {
    await ticket.update({ status: "pending" });
  }

  await CreateMessageService({
    messageData: messageData as any,
    companyId: whatsapp.companyId
  });
};

export default handleCall;
