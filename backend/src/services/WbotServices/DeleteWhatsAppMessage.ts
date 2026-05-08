import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import DeleteMessage from "../UazapiServices/chat/DeleteMessage";

const DeleteWhatsAppMessage = async (messageId: string): Promise<Message> => {
  const message = await Message.findByPk(messageId, {
    include: [
      {
        model: Ticket,
        as: "ticket",
        include: ["contact"]
      }
    ]
  });

  if (!message) {
    throw new AppError("No message found with this ID.");
  }

  const { ticket } = message;
  const whatsapp = await ShowWhatsAppService(ticket.whatsappId, ticket.companyId);

  try {
    await DeleteMessage(whatsapp, { id: message.id });
  } catch (err) {
    throw new AppError("ERR_DELETE_WAPP_MSG");
  }

  await message.update({ isDeleted: true });
  return message;
};

export default DeleteWhatsAppMessage;
