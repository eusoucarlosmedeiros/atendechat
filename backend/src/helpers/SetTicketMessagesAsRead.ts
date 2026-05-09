import { getIO } from "../libs/socket";
import Message from "../models/Message";
import Ticket from "../models/Ticket";
import ShowWhatsAppService from "../services/WhatsappService/ShowWhatsAppService";
import ReadChat from "../services/UazapiServices/chat/ReadChat";
import { logger } from "../utils/logger";

/**
 * Marca todas as mensagens nao lidas do ticket como lidas (incluindo
 * envio de "visto" ao remetente via uazapi).
 *
 * Substitui a chamada wbot.chatModify({ markRead, lastMessages }) da
 * Baileys por POST /chat/read.
 */
const SetTicketMessagesAsRead = async (ticket: Ticket): Promise<void> => {
  await ticket.update({ unreadMessages: 0 });

  try {
    const unreadCount = await Message.count({
      where: { ticketId: ticket.id, fromMe: false, read: false }
    });

    if (unreadCount > 0) {
      const whatsapp = await ShowWhatsAppService(
        ticket.whatsappId,
        ticket.companyId
      );
      // Prefere remoteJid (JID original recebido) sobre construir
      // <number>@s.whatsapp.net — evita 500 quando number e LID.
      const contactJid = (ticket.contact as any).remoteJid;
      const number = contactJid
        ? contactJid
        : ticket.isGroup
        ? `${ticket.contact.number}@g.us`
        : ticket.contact.number;
      await ReadChat(whatsapp, { number, read: true });
    }

    await Message.update(
      { read: true },
      { where: { ticketId: ticket.id, read: false } }
    );
  } catch (err: any) {
    // err pode ser AppError ou Error puro. Nunca usa template string crua
    // que gera "[object Object]".
    const detail = err?.message || err?.uazapiCode || "?";
    logger.warn(
      `SetTicketMessagesAsRead falhou (ticket=${ticket.id}): ${detail}`
    );
  }

  const io = getIO();
  io.to(`company-${ticket.companyId}-mainchannel`).emit(
    `company-${ticket.companyId}-ticket`,
    { action: "updateUnread", ticketId: ticket.id }
  );
};

export default SetTicketMessagesAsRead;
