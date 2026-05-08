import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";
import { SendMessageResponse } from "./SendText";

export type UazapiMediaType =
  | "image"
  | "video"
  | "audio"     // arquivo de musica (vai como media)
  | "myaudio"   // alias de ptt
  | "ptt"       // mensagem de voz (push-to-talk)
  | "ptv"       // push-to-video (round video)
  | "document"
  | "sticker";

export interface SendMediaParams {
  number: string;
  type: UazapiMediaType;
  /**
   * URL HTTPS publica OU base64 do arquivo. Para arquivos servidos pelo
   * proprio backend, prefira a URL (mais leve que base64 no payload).
   */
  file: string;
  /** Caption (texto que acompanha imagem/video/document). */
  text?: string;
  /** Nome customizado quando type=document. */
  docName?: string;
  /** Mime explicito; quando ausente, uazapi detecta. */
  mimetype?: string;
  /** Thumbnail customizada (URL ou base64) — videos/documentos. */
  thumbnail?: string;
  replyid?: string;
  mentions?: string;
  delay?: number;
  readchat?: boolean;
  readmessages?: boolean;
  track_id?: string;
  track_source?: string;
}

/**
 * POST /send/media — envia midia (imagem, video, audio, ptt, document,
 * sticker, ptv) seja por URL HTTPS publica ou base64.
 */
const SendMedia = async (
  whatsapp: Whatsapp,
  params: SendMediaParams
): Promise<SendMessageResponse> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/send/media", params);
  return res.data;
};

export default SendMedia;
