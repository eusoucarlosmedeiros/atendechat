import axios from "axios";
import { isNil } from "lodash";

import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import QueueIntegrations from "../../models/QueueIntegrations";
import { logger } from "../../utils/logger";
import UpdateTicketService from "../TicketServices/UpdateTicketService";

import SendText from "../UazapiServices/send/SendText";
import SendMedia from "../UazapiServices/send/SendMedia";
import SendPresence from "../UazapiServices/chat/SendPresence";

interface Request {
  whatsapp: Whatsapp;
  /** JID/numero do destinatario (ex.: "<num>@s.whatsapp.net" ou "<num>"). */
  remoteJid: string;
  /** Body textual ja extraido do payload uazapi. */
  body: string | null | undefined;
  /** pushName do remetente (preenchido se disponivel). */
  pushName?: string;
  ticket: Ticket;
  typebot: QueueIntegrations;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Listener do Typebot integrado — versao uazapi.
 *
 * Migrado da versao Baileys (que recebia wbot + proto.IWebMessageInfo).
 * Agora recebe direto:
 *   - whatsapp: model com config uazapi (token + base url)
 *   - remoteJid: destinatario para presence + sendMessage
 *   - body: texto ja extraido do payload uazapi (handleMessages faz a extracao)
 *
 * Fluxo:
 *   1. Verifica expiracao da sessao do typebot.
 *   2. Cria/reusa sessao no Typebot via REST.
 *   3. Para cada mensagem retornada (text/audio/image), envia ao usuario
 *      com presence "composing" antes (UX de "esta digitando").
 *   4. Trata gatilhos especiais (#json com stopBot/queueId/userId).
 */
const typebotListener = async ({
  whatsapp,
  remoteJid,
  body,
  pushName,
  ticket,
  typebot
}: Request): Promise<void> => {
  if (!remoteJid || remoteJid === "status@broadcast") return;

  const {
    urlN8N: url,
    typebotExpires,
    typebotKeywordFinish,
    typebotKeywordRestart,
    typebotUnknownMessage,
    typebotSlug,
    typebotDelayMessage,
    typebotRestartMessage
  } = typebot;

  const numberOnly = remoteJid.replace(/\D/g, "");
  const delayMs = Number(typebotDelayMessage || 0);

  const sendWithPresence = async (
    sender: () => Promise<unknown>
  ): Promise<void> => {
    try {
      await SendPresence(whatsapp, { number: remoteJid, type: "composing" });
    } catch (_) { /* nao bloqueante */ }
    if (delayMs > 0) await sleep(delayMs);
    try {
      await SendPresence(whatsapp, { number: remoteJid, type: "paused" });
    } catch (_) { /* nao bloqueante */ }
    await sender();
  };

  async function createSession(): Promise<any> {
    try {
      const reqData = JSON.stringify({
        isStreamEnabled: true,
        message: "string",
        resultId: "string",
        isOnlyRegistering: false,
        prefilledVariables: {
          number: numberOnly,
          pushName: pushName || ""
        }
      });
      const config = {
        method: "post" as const,
        maxBodyLength: Infinity,
        url: `${url}/api/v1/typebots/${typebotSlug}/startChat`,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        data: reqData
      };
      const request = await axios.request(config);
      return request.data;
    } catch (err) {
      logger.info("Erro ao criar sessao do typebot: ", err);
      throw err;
    }
  }

  let sessionId: string | undefined;
  let dataStart: any;
  let status = false;

  try {
    const dataLimite = new Date();
    dataLimite.setMinutes(dataLimite.getMinutes() - Number(typebotExpires));

    if (typebotExpires > 0 && ticket.updatedAt < dataLimite) {
      await ticket.update({ typebotSessionId: null, isBot: true });
      await ticket.reload();
    }

    if (isNil(ticket.typebotSessionId)) {
      dataStart = await createSession();
      sessionId = dataStart.sessionId;
      status = true;
      await ticket.update({
        typebotSessionId: sessionId,
        typebotStatus: true,
        useIntegration: true,
        integrationId: typebot.id
      });
    } else {
      sessionId = ticket.typebotSessionId;
      status = ticket.typebotStatus;
    }

    if (!status) return;

    if (body !== typebotKeywordFinish && body !== typebotKeywordRestart) {
      let messages: any[] = [];
      let input: any;

      if (dataStart?.messages?.length === 0 || dataStart === undefined) {
        const reqData = JSON.stringify({ message: body || "" });
        const config = {
          method: "post" as const,
          maxBodyLength: Infinity,
          url: `${url}/api/v1/sessions/${sessionId}/continueChat`,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          data: reqData
        };
        const requestContinue = await axios.request(config);
        messages = requestContinue.data?.messages || [];
        input = requestContinue.data?.input;
      } else {
        messages = dataStart?.messages || [];
        input = dataStart?.input;
      }

      if (messages.length === 0) {
        await SendText(whatsapp, { number: remoteJid, text: typebotUnknownMessage });
      } else {
        for (const message of messages) {
          if (message.type === "text") {
            const formattedText = renderRichText(message)
              || typebotUnknownMessage;

            // Gatilho com #JSON: stopBot / queueId / userId
            if (formattedText.startsWith("#")) {
              const gatilho = formattedText.replace("#", "");
              try {
                const jsonGatilho = JSON.parse(gatilho);
                if (jsonGatilho.stopBot && isNil(jsonGatilho.userId) && isNil(jsonGatilho.queueId)) {
                  await ticket.update({ useIntegration: false, isBot: false });
                  return;
                }
                if (!isNil(jsonGatilho.queueId) && jsonGatilho.queueId > 0 && isNil(jsonGatilho.userId)) {
                  await UpdateTicketService({
                    ticketData: {
                      queueId: jsonGatilho.queueId,
                      chatbot: false,
                      useIntegration: false,
                      integrationId: null
                    },
                    ticketId: ticket.id,
                    companyId: ticket.companyId
                  });
                  return;
                }
                if (!isNil(jsonGatilho.queueId) && jsonGatilho.queueId > 0 && !isNil(jsonGatilho.userId) && jsonGatilho.userId > 0) {
                  await UpdateTicketService({
                    ticketData: {
                      queueId: jsonGatilho.queueId,
                      userId: jsonGatilho.userId,
                      chatbot: false,
                      useIntegration: false,
                      integrationId: null
                    },
                    ticketId: ticket.id,
                    companyId: ticket.companyId
                  });
                  return;
                }
              } catch (_) {
                // gatilho com # mas nao e JSON valido — manda como texto comum
              }
            }

            await sendWithPresence(() =>
              SendText(whatsapp, { number: remoteJid, text: formattedText })
            );
          }

          if (message.type === "audio") {
            await sendWithPresence(() =>
              SendMedia(whatsapp, {
                number: remoteJid,
                type: "ptt",
                file: message.content.url,
                mimetype: "audio/mp4"
              })
            );
          }

          if (message.type === "image") {
            await sendWithPresence(() =>
              SendMedia(whatsapp, {
                number: remoteJid,
                type: "image",
                file: message.content.url
              })
            );
          }
        }

        if (input?.type === "choice input") {
          const items = input.items || [];
          let formattedText = items.map((it: any) => `▶️ ${it.content}`).join("\n");
          formattedText = formattedText.replace(/\n$/, "");
          await sendWithPresence(() =>
            SendText(whatsapp, { number: remoteJid, text: formattedText })
          );
        }
      }
    }

    if (body === typebotKeywordRestart) {
      await ticket.update({ isBot: true, typebotSessionId: null });
      await ticket.reload();
      await SendText(whatsapp, { number: remoteJid, text: typebotRestartMessage });
    }
    if (body === typebotKeywordFinish) {
      await UpdateTicketService({
        ticketData: { status: "closed", useIntegration: false, integrationId: null },
        ticketId: ticket.id,
        companyId: ticket.companyId
      });
      return;
    }
  } catch (error) {
    logger.info("Error on typebotListener: ", error);
    await ticket.update({ typebotSessionId: null });
    throw error;
  }
};

/**
 * Renderiza richText do Typebot em texto plano com formatacao do WhatsApp.
 * Suporta bold (*), italic (_), strikethrough (~) e [text](url) para link.
 */
const renderRichText = (message: any): string => {
  let formattedText = "";
  try {
    for (const richText of message.content?.richText || []) {
      for (const element of richText.children || []) {
        let text = element.text || "";
        if (element.type && element.children) {
          for (const sub of element.children) {
            let subText = sub.text || "";
            if (sub.bold) subText = `*${subText}*`;
            if (sub.italic) subText = `_${subText}_`;
            if (sub.underline) subText = `~${subText}~`;
            if (sub.url && sub.children?.[0]) {
              subText = `[${sub.children[0].text}](${sub.url})`;
            }
            text += subText;
          }
        } else {
          if (element.bold) text = `*${text}*`;
          if (element.italic) text = `_${text}_`;
          if (element.underline) text = `~${text}~`;
          if (element.url && element.children?.[0]) {
            text = `[${element.children[0].text}](${element.url})`;
          }
        }
        formattedText += text;
      }
      formattedText += "\n";
    }
  } catch (_) { /* swallow */ }
  return formattedText.replace("**", "").replace(/\n$/, "");
};

export default typebotListener;
