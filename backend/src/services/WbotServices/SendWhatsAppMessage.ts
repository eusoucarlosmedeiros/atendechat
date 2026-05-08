import { WAMessage } from "baileys";
import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";

import formatBody from "../../helpers/Mustache";
import { buildJidForSending, getLidForPn } from "../../helpers/LidPnResolver";

interface Request {
  body: string;
  ticket: Ticket;
  quotedMsg?: Message;
}

const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsg
}: Request): Promise<WAMessage> => {
  let options = {};
  const wbot = await GetTicketWbot(ticket);

  // Resolve o melhor JID para enviar:
  //   - Grupo: <id>@g.us (mantido como antes)
  //   - DM: prefere @lid (se temos um LID conhecido para esse contato),
  //         senao cai pro telefone @s.whatsapp.net.
  // Se o contato nao tem LID salvo, ainda consultamos o cache LidMappings
  // (caso outro ticket do mesmo numero ja tenha visto o LID).
  let lid = ticket.contact?.lid as string | undefined;
  if (!lid && !ticket.isGroup && ticket.contact?.number && ticket.whatsappId) {
    lid = await getLidForPn(ticket.contact.number, ticket.whatsappId);
  }
  const number = buildJidForSending({
    lid,
    pn: ticket.contact.number,
    isGroup: ticket.isGroup
  });

  if (quotedMsg) {
      const chatMessages = await Message.findOne({
        where: {
          id: quotedMsg.id
        }
      });

      if (chatMessages) {
        const msgFound = JSON.parse(chatMessages.dataJson);

        options = {
          quoted: {
            key: msgFound.key,
            message: {
              extendedTextMessage: msgFound.message.extendedTextMessage
            }
          }
        };
      }
    
  }

  try {
    const sentMessage = await wbot.sendMessage(number,{
        text: formatBody(body, ticket.contact)
      },
      {
        ...options
      }
    );

    await ticket.update({ lastMessage: formatBody(body, ticket.contact) });
    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMessage;
