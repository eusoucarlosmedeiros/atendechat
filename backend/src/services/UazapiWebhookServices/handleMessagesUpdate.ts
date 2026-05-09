import Whatsapp from "../../models/Whatsapp";
import Message from "../../models/Message";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";

/**
 * Schema do evento `messages_update` (uazapi).
 *
 * Formato real visto em producao:
 *   {
 *     "EventType": "messages_update",
 *     "event": {
 *       "Chat": "...",
 *       "IsFromMe": false,
 *       "MessageIDs": ["3EB0..."],   // <- ARRAY (plural)
 *       "Sender": "...",
 *       "Timestamp": 1778289276,
 *       "Type": "Delivered"           // Sent | Delivered | Read | Played
 *     },
 *     "state": "Delivered",
 *     "type": "ReadReceipt"
 *   }
 */

// Mapeamento alinhado com a convencao Baileys/legacy do frontend:
//   1 = Pending (relogio)
//   2 = Sent / Server ACK (1 check)
//   3 = Delivered (2 checks)
//   4 = Read (2 checks azuis)
//   5 = Played (audio ouvido)
const STATUS_TO_ACK: Record<string, number> = {
  pending: 1,
  sent: 2,
  server_ack: 2,
  delivered: 3,
  delivery_ack: 3,
  read: 4,
  read_self: 4,
  played: 5,
  played_self: 5
};

/**
 * Handler do evento `messages_update`. Recebe o `event` ja desempacotado
 * pelo router (vide router.ts: payload?.event || payload).
 */
const handleMessagesUpdate = async (
  payload: any,
  whatsapp: Whatsapp
): Promise<void> => {
  const evt = payload || {};

  // MessageIDs vem como array (plural). Em raros providers pode vir
  // singular como id/MessageID. Tolera ambos.
  const messageIds: string[] = Array.isArray(evt.MessageIDs)
    ? evt.MessageIDs
    : evt.id
    ? [evt.id]
    : evt.messageid
    ? [evt.messageid]
    : [];

  if (messageIds.length === 0) {
    logger.warn(
      `[uazapi] messages_update sem MessageIDs (wid=${whatsapp.id}) ` +
      `payload=${JSON.stringify(evt).slice(0, 400)}`
    );
    return;
  }

  // Type vem em PascalCase no event; state/Status no envelope. Normaliza.
  const rawStatus = (evt.Type || evt.state || evt.status || "").toString().toLowerCase();
  const ack = STATUS_TO_ACK[rawStatus];

  for (const id of messageIds) {
    try {
      const message = await Message.findByPk(String(id), { include: ["ticket"] });
      if (!message) continue;

      const updates: any = {};
      if (ack !== undefined && ack > (message.ack || 0)) {
        updates.ack = ack;
      }
      if (evt.deleted === true || rawStatus === "deleted") {
        updates.isDeleted = true;
      }
      if (evt.edited === true && evt.text) {
        updates.body = evt.text;
        updates.isEdited = true;
      }
      if (Object.keys(updates).length === 0) continue;

      await message.update(updates);
      await message.reload();

      const io = getIO();
      if (message.ticket) {
        io.to(message.ticketId.toString())
          .to(`company-${whatsapp.companyId}-${message.ticket.status}`)
          .to(`company-${whatsapp.companyId}-notification`)
          .emit(`company-${whatsapp.companyId}-appMessage`, {
            action: "update",
            message,
            ticket: message.ticket,
            contact: message.ticket.contact
          });
      }

      logger.debug(
        `[uazapi] messages_update msg=${id} ack=${updates.ack} wid=${whatsapp.id}`
      );
    } catch (err: any) {
      logger.warn(
        `[uazapi] messages_update erro msg=${id} wid=${whatsapp.id}: ${err?.message || err}`
      );
    }
  }
};

export default handleMessagesUpdate;
