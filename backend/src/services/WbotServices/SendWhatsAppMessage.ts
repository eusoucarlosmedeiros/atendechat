import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import CreateMessageService from "../MessageServices/CreateMessageService";
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
 * Envia mensagem de texto via uazapi e persiste a Message no banco
 * imediatamente apos sucesso da uazapi.
 *
 * IMPORTANTE: configuramos webhook com excludeMessages=["wasSentByApi"]
 * (evita loop de auto-eco). Por isso o webhook NAO entrega de volta a
 * mensagem que a propria API enviou. Se nao persistirmos aqui, a
 * mensagem nunca aparece no chat do ticket.
 *
 * Spec /send/text response: schema Message + { response: {...} }
 * Campos relevantes do response: messageid (ID original WhatsApp) ou
 * id (ID interno uazapi).
 */
const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsg
}: Request): Promise<SendMessageResponse> => {
  const whatsapp = await ShowWhatsAppService(ticket.whatsappId, ticket.companyId);

  const contactJid = (ticket.contact as any).remoteJid;
  const number = contactJid
    ? contactJid
    : ticket.isGroup
    ? `${ticket.contact.number}@g.us`
    : ticket.contact.number;

  try {
    const formatted = formatBody(body, ticket.contact);
    const response: any = await SendText(whatsapp, {
      number,
      text: formatted,
      replyid: quotedMsg?.id
    });

    // ID estavel para o registro local. Prioriza messageid (ID WhatsApp)
    // pois sobrevive a re-syncs e e o que aparece em messages_update.
    const messageId = response?.messageid || response?.id;

    if (messageId) {
      try {
        await CreateMessageService({
          messageData: {
            id: String(messageId),
            ticketId: ticket.id,
            body: formatted,
            fromMe: true,
            read: true,
            mediaType: "conversation",
            quotedMsgId: quotedMsg?.id,
            ack: 1, // Sent (1 check). Updates de Delivered/Read vem via webhook.
            remoteJid: number,
            dataJson: JSON.stringify(response)
          } as any,
          companyId: ticket.companyId
        });
      } catch (persistErr: any) {
        // Se ja existe (idempotencia — webhook chegou antes), ignora.
        if (!String(persistErr?.message || "").includes("Validation")) {
          Sentry.captureException(persistErr);
        }
      }
    }

    await ticket.update({ lastMessage: formatted });
    return response;
  } catch (err: any) {
    Sentry.captureException(err);
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMessage;
