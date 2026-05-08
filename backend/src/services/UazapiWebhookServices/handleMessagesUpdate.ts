import Whatsapp from "../../models/Whatsapp";
import Message from "../../models/Message";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";

/**
 * Handler do evento `messages_update` — atualiza status (ack) de mensagens
 * que ja enviamos. Tambem cobre `delete` e edicoes.
 *
 * Mapeamento de status uazapi -> ack interno (mantido compativel com o
 * sistema atual, que ja usa numeros para representar os checks):
 *   Pending   = 0
 *   Sent      = 1   (1 check)
 *   Delivered = 2   (2 checks)
 *   Read      = 3   (2 checks azuis)
 *   Played    = 4   (audio ouvido)
 */
const STATUS_TO_ACK: Record<string, number> = {
  pending: 0,
  sent: 1,
  server_ack: 1,
  delivered: 2,
  delivery_ack: 2,
  read: 3,
  read_self: 3,
  played: 4,
  played_self: 4
};

const handleMessagesUpdate = async (
  payload: any,
  whatsapp: Whatsapp
): Promise<void> => {
  const messageId: string =
    payload.id || payload.message_id || payload.messageId || "";
  if (!messageId) {
    logger.warn(`[uazapi] messages_update sem id (wid=${whatsapp.id})`);
    return;
  }

  // Status ou edited?
  const status: string = (payload.status || "").toString().toLowerCase();
  const ack = STATUS_TO_ACK[status];

  const message = await Message.findByPk(messageId, { include: ["ticket"] });
  if (!message) {
    // Pode ser update de mensagem que nao foi persistida ainda. Skip.
    return;
  }

  const updates: any = {};
  if (ack !== undefined && ack > (message.ack || 0)) {
    updates.ack = ack;
  }
  if (payload.deleted === true || status === "deleted") {
    updates.isDeleted = true;
  }
  if (payload.edited === true && payload.text) {
    updates.body = payload.text;
    updates.isEdited = true;
  }

  if (Object.keys(updates).length === 0) return;

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
};

export default handleMessagesUpdate;
