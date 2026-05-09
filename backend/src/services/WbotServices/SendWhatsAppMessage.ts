import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import SendText, {
  SendMessageResponse
} from "../UazapiServices/send/SendText";
import formatBody from "../../helpers/Mustache";

interface Request {
  body: string;
  ticket: Ticket;
  quotedMsg?: Message;
}

/**
 * Envia mensagem de texto via uazapi.
 *
 * - Para 1:1: passa o `Contact.number` puro (E.164). uazapi resolve LID
 *   internamente, eliminando todo o drama da Baileys com @lid.
 * - Para grupo: passa `<groupId>@g.us`.
 * - Quote/reply: usa o id da mensagem original em `replyid`.
 *
 * A persistencia da Message fica para quando o webhook 'messages' chegar
 * com `from_me: true` — handleMessages faz o upsert. Devolvemos so o que
 * a uazapi respondeu (id + status + timestamp) para o caller.
 */
const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsg
}: Request): Promise<SendMessageResponse> => {
  const whatsapp = await ShowWhatsAppService(ticket.whatsappId, ticket.companyId);

  // Preferimos o remoteJid persistido (JID original recebido pela uazapi)
  // — e a fonte de verdade. Cai em fallback para construcao a partir do
  // number quando contato e antigo (pre-migracao).
  const contactJid = (ticket.contact as any).remoteJid;
  const number = contactJid
    ? contactJid
    : ticket.isGroup
    ? `${ticket.contact.number}@g.us`
    : ticket.contact.number;

  try {
    const formatted = formatBody(body, ticket.contact);
    const response = await SendText(whatsapp, {
      number,
      text: formatted,
      replyid: quotedMsg?.id
    });
    await ticket.update({ lastMessage: formatted });
    return response;
  } catch (err) {
    Sentry.captureException(err);
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMessage;
