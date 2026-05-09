import * as Sentry from "@sentry/node";
import fs from "fs";
import { exec } from "child_process";
import path from "path";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { lookup } from "mime-types";

import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import SendMedia, {
  SendMediaParams,
  UazapiMediaType
} from "../UazapiServices/send/SendMedia";
import { SendMessageResponse } from "../UazapiServices/send/SendText";
import formatBody from "../../helpers/Mustache";

interface Request {
  media: Express.Multer.File;
  ticket: Ticket;
  body?: string;
}

const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

const processAudio = async (audio: string): Promise<string> => {
  const outputAudio = `${publicFolder}/${new Date().getTime()}.mp3`;
  return new Promise((resolve, reject) => {
    exec(
      `${ffmpegPath.path} -i ${audio} -vn -ab 128k -ar 44100 -f ipod ${outputAudio} -y`,
      (error, _stdout, _stderr) => {
        if (error) reject(error);
        try { fs.unlinkSync(audio); } catch (_) { /* noop */ }
        resolve(outputAudio);
      }
    );
  });
};

const processAudioFile = async (audio: string): Promise<string> => {
  const outputAudio = `${publicFolder}/${new Date().getTime()}.mp3`;
  return new Promise((resolve, reject) => {
    exec(
      `${ffmpegPath.path} -i ${audio} -vn -ar 44100 -ac 2 -b:a 192k ${outputAudio}`,
      (error, _stdout, _stderr) => {
        if (error) reject(error);
        try { fs.unlinkSync(audio); } catch (_) { /* noop */ }
        resolve(outputAudio);
      }
    );
  });
};

/**
 * Constroi os params para o /send/media da uazapi a partir de um arquivo
 * local (path/mimetype/originalname). Retorna pronto para passar ao
 * wrapper SendMedia.
 *
 * file vai como base64 inline — para volumes muito grandes (>10MB) o ideal
 * seria servir via URL HTTPS publica do nosso backend, mas mantendo
 * paridade com o comportamento atual usamos base64 por simplicidade.
 */
export const getMessageOptions = async (
  fileName: string,
  pathMedia: string,
  body?: string
): Promise<Partial<SendMediaParams> | null> => {
  const mimeType = (lookup(pathMedia) || "") as string;
  const typeMessage = mimeType.split("/")[0];

  try {
    if (!mimeType) throw new Error("Invalid mimetype");

    let type: UazapiMediaType;
    let finalPath = pathMedia;
    let mimetype = mimeType;
    let docName: string | undefined;

    if (typeMessage === "video") {
      type = "video";
    } else if (typeMessage === "audio") {
      type = "ptt"; // mantem comportamento atual: audios sao enviados como PTT
      finalPath = await processAudio(pathMedia);
      mimetype = "audio/mp4";
    } else if (typeMessage === "image") {
      type = "image";
    } else {
      // application/pdf, document, etc
      type = "document";
      docName = fileName;
    }

    const fileBuffer = fs.readFileSync(finalPath);
    const fileBase64 = `data:${mimetype};base64,${fileBuffer.toString("base64")}`;

    return {
      type,
      file: fileBase64,
      text: body || undefined,
      mimetype,
      docName
    };
  } catch (e) {
    Sentry.captureException(e);
    console.log(e);
    return null;
  }
};

const SendWhatsAppMedia = async ({
  media,
  ticket,
  body
}: Request): Promise<SendMessageResponse> => {
  try {
    const whatsapp = await ShowWhatsAppService(ticket.whatsappId, ticket.companyId);
    const bodyMessage = body ? formatBody(body, ticket.contact) : undefined;

    // Prefere o remoteJid (JID original) — fonte de verdade pra uazapi.
    const contactJid = (ticket.contact as any).remoteJid;
    const number = contactJid
      ? contactJid
      : ticket.isGroup
      ? `${ticket.contact.number}@g.us`
      : ticket.contact.number;

    const pathMedia = media.path;
    const mimetype = media.mimetype;
    const typeMessage = mimetype.split("/")[0];

    let type: UazapiMediaType;
    let finalPath = pathMedia;
    let finalMime = mimetype;
    let docName: string | undefined;

    if (typeMessage === "video") {
      type = "video";
    } else if (typeMessage === "audio") {
      const isVoiceRecord = media.originalname.includes("audio-record-site");
      finalPath = isVoiceRecord
        ? await processAudio(media.path)
        : await processAudioFile(media.path);
      finalMime = "audio/mp4";
      type = isVoiceRecord ? "ptt" : "audio";
    } else if (typeMessage === "image") {
      type = "image";
    } else {
      type = "document";
      docName = media.originalname;
    }

    const fileBuffer = fs.readFileSync(finalPath);
    const fileBase64 = `data:${finalMime};base64,${fileBuffer.toString("base64")}`;

    const response: any = await SendMedia(whatsapp, {
      number,
      type,
      file: fileBase64,
      text: bodyMessage,
      mimetype: finalMime,
      docName
    });

    // Persiste a Message localmente (webhook nao ecoa por causa do
    // excludeMessages=wasSentByApi). messageid > id como ID estavel.
    const messageId = response?.messageid || response?.id;
    if (messageId) {
      // mediaType compativel com a UI legacy (image/video/audio/document).
      // ptt eh tratado como audio na UI; outros tipos passam direto.
      const uiMediaType: string = type === "ptt" ? "audio" : type;
      const localFileName = path.basename(finalPath);
      try {
        await CreateMessageService({
          messageData: {
            id: String(messageId),
            ticketId: ticket.id,
            body: bodyMessage || `[${uiMediaType}]`,
            fromMe: true,
            read: true,
            mediaUrl: localFileName,
            mediaType: uiMediaType,
            ack: 1,
            remoteJid: number,
            dataJson: JSON.stringify(response)
          } as any,
          companyId: ticket.companyId
        });
      } catch (persistErr: any) {
        if (!String(persistErr?.message || "").includes("Validation")) {
          Sentry.captureException(persistErr);
        }
      }
    }

    if (bodyMessage) {
      await ticket.update({ lastMessage: bodyMessage });
    } else {
      await ticket.update({ lastMessage: `[${type}]` });
    }

    return response;
  } catch (err) {
    Sentry.captureException(err);
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMedia;
