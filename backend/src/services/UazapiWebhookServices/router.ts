import Whatsapp from "../../models/Whatsapp";
import handleMessages from "./handleMessages";
import handleMessagesUpdate from "./handleMessagesUpdate";
import handleConnection from "./handleConnection";
import handleCall from "./handleCall";
import handleContacts from "./handleContacts";
import handlePresence from "./handlePresence";
import { logger } from "../../utils/logger";

/**
 * Desencapsula o envelope da uazapi.
 *
 * Formato real visto em producao:
 *   {
 *     "BaseUrl": "...",
 *     "EventType": "messages" | "contacts" | "presence" | ...,
 *     "event": { ...dados reais do evento... },
 *     "instanceName": "...",
 *     "owner": "...",
 *     "token": "...",
 *     "type": "..."
 *   }
 *
 * Os handlers recebem o conteudo de `event` (quando existir), nao o
 * envelope. Quando nao houver envelope, passamos o payload bruto
 * (compatibilidade com providers que entregam direto).
 */
const unwrap = (payload: any): any => {
  if (payload && typeof payload === "object" && payload.event && typeof payload.event === "object") {
    return payload.event;
  }
  return payload;
};

/**
 * Despacha um evento da uazapi para o handler apropriado.
 * Eventos desconhecidos sao apenas logados (sem erro).
 */
export const dispatch = async (
  eventType: string,
  payload: any,
  whatsapp: Whatsapp
): Promise<void> => {
  const inner = unwrap(payload);

  switch (eventType) {
    case "messages":
      return handleMessages(inner, whatsapp);
    case "messages_update":
      return handleMessagesUpdate(inner, whatsapp);
    case "connection":
      return handleConnection(inner, whatsapp);
    case "call":
      return handleCall(inner, whatsapp);
    case "contacts":
      return handleContacts(inner, whatsapp);
    case "presence":
      return handlePresence(inner, whatsapp);
    case "history":
      logger.info(`[uazapi] history recebido para wid=${whatsapp.id} — ignorado`);
      return;
    default:
      logger.warn(`[uazapi] evento desconhecido: ${eventType} (wid=${whatsapp.id})`);
      return;
  }
};
