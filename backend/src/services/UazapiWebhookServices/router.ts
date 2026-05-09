import Whatsapp from "../../models/Whatsapp";
import handleMessages from "./handleMessages";
import handleMessagesUpdate from "./handleMessagesUpdate";
import handleConnection from "./handleConnection";
import handleCall from "./handleCall";
import handleContacts from "./handleContacts";
import handlePresence from "./handlePresence";
import { logger } from "../../utils/logger";

/**
 * Despacha um evento da uazapi para o handler apropriado.
 *
 * Formatos do envelope (conforme schemas Chat e Message do
 * uazapi-openapi-spec.yaml linhas 249-648):
 *
 * - messages / messages_update:
 *     { BaseUrl, EventType, chat: {Chat schema}, message: {Message schema}, ... }
 *
 * - contacts / presence / connection / call:
 *     { BaseUrl, EventType, event: { ... }, ... }
 *
 * Para messages, passamos o payload INTEIRO porque o handler precisa
 * tanto de `chat` quanto de `message`. Para os outros, desempacotamos
 * em `event`.
 */
export const dispatch = async (
  eventType: string,
  payload: any,
  whatsapp: Whatsapp
): Promise<void> => {
  switch (eventType) {
    case "messages":
      return handleMessages(payload, whatsapp);
    case "messages_update":
      return handleMessagesUpdate(payload, whatsapp);
    case "connection":
      return handleConnection(payload?.event || payload, whatsapp);
    case "call":
      return handleCall(payload?.event || payload, whatsapp);
    case "contacts":
      return handleContacts(payload?.event || payload, whatsapp);
    case "presence":
      return handlePresence(payload?.event || payload, whatsapp);
    case "history":
      logger.info(`[uazapi] history recebido para wid=${whatsapp.id} — ignorado`);
      return;
    default:
      logger.warn(`[uazapi] evento desconhecido: ${eventType} (wid=${whatsapp.id})`);
      return;
  }
};
