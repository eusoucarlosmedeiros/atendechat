import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export interface SendTextParams {
  /**
   * Telefone E.164 (ex.: 5511999999999) OU JID completo
   * (5511999999999@s.whatsapp.net | 1234567@g.us | 12345@lid).
   * A uazapi normaliza automaticamente.
   */
  number: string;
  text: string;
  /** ID da mensagem para reply (quoted). */
  replyid?: string;
  /** Numeros separados por virgula para mencionar (groups). */
  mentions?: string;
  linkPreview?: boolean;
  linkPreviewTitle?: string;
  linkPreviewDescription?: string;
  linkPreviewImage?: string;
  linkPreviewLarge?: boolean;
  /** Delay em ms (mostra "Digitando..." ao destinatario). */
  delay?: number;
  readchat?: boolean;
  readmessages?: boolean;
  /** ID livre para tracking interno do Atendechat. */
  track_id?: string;
  /** Origem livre para audit trail. */
  track_source?: string;
}

export interface SendMessageResponse {
  id: string;
  status: string;
  timestamp: number;
  [key: string]: any;
}

/**
 * POST /send/text — envia mensagem de texto (1:1 ou grupo).
 */
const SendText = async (
  whatsapp: Whatsapp,
  params: SendTextParams
): Promise<SendMessageResponse> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/send/text", params);
  return res.data;
};

export default SendText;
