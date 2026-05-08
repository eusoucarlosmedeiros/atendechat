import * as Sentry from "@sentry/node";
import makeWASocket, {
  WASocket,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  proto,
  GroupMetadata,
  CacheStore
} from "baileys";
import P from "pino";

import Whatsapp from "../models/Whatsapp";
import Message from "../models/Message";
import { logger } from "../utils/logger";
import authState from "../helpers/authState";
import { Boom } from "@hapi/boom";
import AppError from "../errors/AppError";
import { getIO } from "./socket";
import { Store } from "./store";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import DeleteBaileysService from "../services/BaileysServices/DeleteBaileysService";
import NodeCache from "node-cache";

const loggerBaileys = P({ level: "error" });

type Session = WASocket & {
  id?: number;
  store?: Store;
};

const sessions: Session[] = [];

const retriesQrCodeMap = new Map<number, number>();

// Evita disparar initWASocket varias vezes para o mesmo whatsappId em paralelo,
// que era a causa de WebSockets fantasmas e do erro "device_removed".
const initInProgress = new Set<number>();

export const getWbot = (whatsappId: number): Session => {
  const sessionIndex = sessions.findIndex(s => s.id === whatsappId);

  if (sessionIndex === -1) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }
  return sessions[sessionIndex];
};

export const removeWbot = async (
  whatsappId: number,
  isLogout = true
): Promise<void> => {
  try {
    const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
    if (sessionIndex !== -1) {
      const session = sessions[sessionIndex];
      try {
        session.ev.removeAllListeners("connection.update");
        session.ev.removeAllListeners("creds.update");
        session.ev.removeAllListeners("messages.upsert");
      } catch (e) { /* noop */ }

      if (isLogout) {
        try { await session.logout(); } catch (e) { /* noop */ }
      }
      try { session.ws.close(); } catch (e) { /* noop */ }
      try { (session.end as any)?.(undefined); } catch (e) { /* noop */ }

      sessions.splice(sessionIndex, 1);
    }
  } catch (err) {
    logger.error(err);
  }
};

export const initWASocket = async (whatsapp: Whatsapp): Promise<Session> => {
  return new Promise(async (resolve, reject) => {
    try {
      // Lock para evitar inicializacoes concorrentes da mesma sessao.
      if (initInProgress.has(whatsapp.id)) {
        logger.warn(`initWASocket ignorado: sessao ${whatsapp.id} ja esta inicializando`);
        return resolve(undefined as any);
      }
      initInProgress.add(whatsapp.id);

      // Garante que qualquer socket antigo da mesma sessao seja totalmente fechado.
      await removeWbot(whatsapp.id, false);

      (async () => {
        const io = getIO();

        const whatsappUpdate = await Whatsapp.findOne({
          where: { id: whatsapp.id }
        });

        if (!whatsappUpdate) {
          initInProgress.delete(whatsapp.id);
          return;
        }

        const { id, name } = whatsappUpdate;

        const { version, isLatest } = await fetchLatestBaileysVersion();

        logger.info(`using WA v${version.join(".")}, isLatest: ${isLatest}`);
        logger.info(`Starting session ${name}`);
        let retriesQrCode = 0;

        let wsocket: Session = null;

        const { state, saveState } = await authState(whatsapp);

        const msgRetryCounterCache = new NodeCache();
        const userDevicesCache: CacheStore = new NodeCache();
        // Cache de metadados de grupos: a Baileys consulta isso em cada envio
        // para grupo. Sem esse cache, envios para grupos sao mais lentos e
        // podem gerar timeouts.
        const groupMetadataCache = new NodeCache({
          stdTTL: 5 * 60,
          useClones: false
        });

        wsocket = makeWASocket({
          logger: loggerBaileys,
          printQRInTerminal: false,
          browser: Browsers.appropriate("Desktop"),
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, loggerBaileys)
          },
          version,
          defaultQueryTimeoutMs: 60_000,
          connectTimeoutMs: 60_000,
          keepAliveIntervalMs: 30_000,
          retryRequestDelayMs: 1000,
          maxMsgRetryCount: 5,
          markOnlineOnConnect: true,
          syncFullHistory: false,
          generateHighQualityLinkPreview: false,
          msgRetryCounterCache,
          userDevicesCache,
          shouldIgnoreJid: jid => isJidBroadcast(jid),
          // Resolve metadata de grupo a partir do cache antes de cair na
          // request via socket. Reduz latencia e evita "Timed Out".
          cachedGroupMetadata: async (jid: string): Promise<GroupMetadata | undefined> => {
            return groupMetadataCache.get<GroupMetadata>(jid);
          },
          // CRITICO: WhatsApp requisita re-envio (retry) de mensagens que
          // nao foram entregues ao destinatario. Se getMessage retornar
          // vazio, o retry quebra e o envio falha silenciosamente — esse
          // era o bug "so recebe nao envia". Buscamos a mensagem real no
          // banco para que o retry funcione.
          getMessage: async (key): Promise<proto.IMessage | undefined> => {
            try {
              if (!key?.id) return undefined;
              const msg = await Message.findByPk(key.id);
              if (!msg?.dataJson) return undefined;
              const parsed = JSON.parse(msg.dataJson);
              return parsed?.message || undefined;
            } catch (err) {
              logger.warn(`getMessage retry falhou para ${key?.id}: ${err}`);
              return undefined;
            }
          }
        });

        wsocket.ev.on(
          "connection.update",
          async ({ connection, lastDisconnect, qr }) => {
            logger.info(
              `Socket  ${name} Connection Update ${connection || ""} ${lastDisconnect || ""
              }`
            );

            if (connection === "close") {
              initInProgress.delete(whatsapp.id);
              const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
              const errorContent = (lastDisconnect?.error as any)?.data?.content?.[0]?.attrs?.type;

              // device_removed = WhatsApp matou o device por conflito.
              // Tratar como logout: limpar session e exigir novo QR, sem reconectar em loop.
              const isDeviceRemoved = errorContent === "device_removed";

              if (statusCode === 403 || isDeviceRemoved || statusCode === DisconnectReason.loggedOut) {
                await whatsapp.update({ status: "PENDING", session: "" });
                await DeleteBaileysService(whatsapp.id);
                io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  session: whatsapp
                });
                await removeWbot(id, false);
                if (statusCode === DisconnectReason.loggedOut) {
                  setTimeout(
                    () => StartWhatsAppSession(whatsapp, whatsapp.companyId),
                    2000
                  );
                }
              } else {
                await removeWbot(id, false);
                setTimeout(
                  () => StartWhatsAppSession(whatsapp, whatsapp.companyId),
                  2000
                );
              }
            }

            if (connection === "open") {
              initInProgress.delete(whatsapp.id);
              await whatsapp.update({
                status: "CONNECTED",
                qrcode: "",
                retries: 0
              });

              io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                action: "update",
                session: whatsapp
              });

              const sessionIndex = sessions.findIndex(
                s => s.id === whatsapp.id
              );
              if (sessionIndex === -1) {
                wsocket.id = whatsapp.id;
                sessions.push(wsocket);
              }

              resolve(wsocket);
            }

            if (qr !== undefined) {
              if (retriesQrCodeMap.get(id) && retriesQrCodeMap.get(id) >= 3) {
                await whatsappUpdate.update({
                  status: "DISCONNECTED",
                  qrcode: ""
                });
                await DeleteBaileysService(whatsappUpdate.id);
                io.to(`company-${whatsapp.companyId}-mainchannel`).emit("whatsappSession", {
                  action: "update",
                  session: whatsappUpdate
                });
                wsocket.ev.removeAllListeners("connection.update");
                wsocket.ws.close();
                wsocket = null;
                retriesQrCodeMap.delete(id);
              } else {
                logger.info(`Session QRCode Generate ${name}`);
                retriesQrCodeMap.set(id, (retriesQrCode += 1));

                await whatsapp.update({
                  qrcode: qr,
                  status: "qrcode",
                  retries: 0
                });
                const sessionIndex = sessions.findIndex(
                  s => s.id === whatsapp.id
                );

                if (sessionIndex === -1) {
                  wsocket.id = whatsapp.id;
                  sessions.push(wsocket);
                }

                io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  session: whatsapp
                });
              }
            }
          }
        );
        wsocket.ev.on("creds.update", saveState);

        // Mantem cache de metadados de grupos sempre atualizado.
        wsocket.ev.on("groups.update", async updates => {
          for (const update of updates) {
            try {
              if (!update.id) continue;
              const meta = await wsocket.groupMetadata(update.id);
              if (meta) groupMetadataCache.set(update.id, meta);
            } catch (e) { /* noop */ }
          }
        });
        wsocket.ev.on("group-participants.update", async ({ id }) => {
          try {
            const meta = await wsocket.groupMetadata(id);
            if (meta) groupMetadataCache.set(id, meta);
          } catch (e) { /* noop */ }
        });
      })();
    } catch (error) {
      initInProgress.delete(whatsapp.id);
      Sentry.captureException(error);
      console.log(error);
      reject(error);
    }
  });
};
