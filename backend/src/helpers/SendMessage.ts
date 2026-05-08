import Whatsapp from "../models/Whatsapp";
import SendText from "../services/UazapiServices/send/SendText";
import SendMedia from "../services/UazapiServices/send/SendMedia";
import { getMessageOptions } from "../services/WbotServices/SendWhatsAppMedia";

export type MessageData = {
  number: number | string;
  body: string;
  mediaPath?: string;
  fileName?: string;
};

/**
 * Envio externo (usado por integracoes/automacoes que recebem um Whatsapp
 * + payload simples). Migrado de wbot.sendMessage para uazapi.
 */
export const SendMessage = async (
  whatsapp: Whatsapp,
  messageData: MessageData
): Promise<any> => {
  try {
    const number = String(messageData.number);

    if (messageData.mediaPath) {
      const options = await getMessageOptions(
        messageData.fileName || "file",
        messageData.mediaPath,
        messageData.body
      );
      if (!options || !options.type || !options.file) {
        throw new Error("Falha ao preparar opcoes de midia");
      }
      return await SendMedia(whatsapp, {
        number,
        type: options.type,
        file: options.file,
        text: options.text,
        mimetype: options.mimetype,
        docName: options.docName
      });
    }

    return await SendText(whatsapp, {
      number,
      text: `‎ ${messageData.body}`
    });
  } catch (err: any) {
    throw new Error(err);
  }
};
