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
 * Eventos desconhecidos sao apenas logados (sem erro).
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
      return handleConnection(payload, whatsapp);
    case "call":
      return handleCall(payload, whatsapp);
    case "contacts":
      return handleContacts(payload, whatsapp);
    case "presence":
      return handlePresence(payload, whatsapp);
    case "history":
      // historico inicial dos ultimos 7 dias — por enquanto ignoramos.
      logger.info(`[uazapi] history recebido para wid=${whatsapp.id} — ignorado`);
      return;
    default:
      logger.warn(`[uazapi] evento desconhecido: ${eventType} (wid=${whatsapp.id})`);
      return;
  }
};
