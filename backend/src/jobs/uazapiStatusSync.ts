import { Op } from "sequelize";
import Whatsapp from "../models/Whatsapp";
import GetInstanceStatus from "../services/UazapiServices/instance/GetInstanceStatus";
import { getIO } from "../libs/socket";
import { logger } from "../utils/logger";

const cron = require("node-cron");

/**
 * Mapeia status da uazapi para o status interno do Atendechat
 * (mantem compativel com o frontend e logica legada que esperava
 * esses valores).
 */
const mapUazapiStatus = (upstream: string | undefined): string => {
  switch ((upstream || "").toLowerCase()) {
    case "connected":
    case "open":
      return "CONNECTED";
    case "qrcode":
    case "qr":
      return "qrcode";
    case "connecting":
      return "OPENING";
    case "disconnected":
    case "close":
      return "DISCONNECTED";
    default:
      return "OPENING";
  }
};

/**
 * Reconcilia o estado de UM whatsapp com a uazapi.
 *
 * Chamado pelo cron periodico e tambem pode ser invocado pontualmente
 * (ex.: depois de um StartWhatsAppSession para confirmar o estado).
 */
export const syncWhatsappStatus = async (
  whatsapp: Whatsapp
): Promise<void> => {
  if (!whatsapp.uazapiInstanceId || !whatsapp.uazapiToken) return;

  let upstream;
  try {
    upstream = await GetInstanceStatus(whatsapp);
  } catch (err: any) {
    // 401/404 → instancia foi removida na uazapi por fora; marca DISCONNECTED
    const status = err?.originalError?.response?.status;
    if (status === 401 || status === 404) {
      logger.warn(
        `[uazapi-sync] instancia wid=${whatsapp.id} sumiu da uazapi (HTTP ${status}). ` +
        `Marcando DISCONNECTED + zerando credenciais para forcar re-init.`
      );
      await whatsapp.update({
        status: "DISCONNECTED",
        qrcode: "",
        uazapiInstanceId: null,
        uazapiToken: null,
        uazapiWebhookSecret: null
      });
      const io = getIO();
      io.to(`company-${whatsapp.companyId}-mainchannel`).emit(
        `company-${whatsapp.companyId}-whatsappSession`,
        { action: "update", session: whatsapp }
      );
      return;
    }
    // outros erros: log e segue (provavel rede/temporario)
    logger.warn(
      `[uazapi-sync] GetInstanceStatus falhou wid=${whatsapp.id}: ${err?.message || err}`
    );
    return;
  }

  const upstreamStatus = upstream.instance?.status;
  const newStatus = mapUazapiStatus(upstreamStatus);
  const upstreamQr = upstream.instance?.qrcode || "";

  // Decide se precisa atualizar e propagar
  const localStatus = whatsapp.status;
  const localQr = whatsapp.qrcode || "";
  const statusChanged = localStatus !== newStatus;
  const qrChanged = localQr !== upstreamQr && newStatus === "qrcode";

  if (!statusChanged && !qrChanged) return;

  const updates: any = { status: newStatus };
  if (newStatus === "CONNECTED") {
    updates.qrcode = "";
    updates.retries = 0;
  } else if (newStatus === "qrcode") {
    if (upstreamQr) updates.qrcode = upstreamQr;
  } else if (newStatus === "DISCONNECTED") {
    updates.qrcode = "";
  }

  await whatsapp.update(updates);
  await whatsapp.reload();

  logger.info(
    `[uazapi-sync] wid=${whatsapp.id} ${localStatus} -> ${newStatus} (upstream=${upstreamStatus})`
  );

  // Emite socket.io para o frontend atualizar em tempo real
  const io = getIO();
  io.to(`company-${whatsapp.companyId}-mainchannel`).emit(
    `company-${whatsapp.companyId}-whatsappSession`,
    { action: "update", session: whatsapp }
  );
};

/**
 * Job periodico — varre todos os Whatsapps com instancia uazapi
 * configurada e reconcilia status. Roda a cada 30s.
 *
 * Esta e a defesa em profundidade contra:
 *   - webhook nao chegar (nginx, firewall, BACKEND_URL errado)
 *   - eventos perdidos durante restart do backend
 *   - alteracoes feitas direto no painel da uazapi (delete manual etc)
 */
export const startUazapiStatusSync = (): void => {
  const job = cron.schedule(
    "*/30 * * * * *", // a cada 30 segundos
    async () => {
      try {
        const whatsapps = await Whatsapp.findAll({
          where: {
            uazapiInstanceId: { [Op.ne]: null },
            uazapiToken: { [Op.ne]: null }
          } as any
        });

        if (whatsapps.length === 0) return;

        // Sequencial para nao esmagar a uazapi com bursts
        for (const wpp of whatsapps) {
          try {
            await syncWhatsappStatus(wpp);
          } catch (err) {
            logger.warn(
              `[uazapi-sync] erro ao sincronizar wid=${wpp.id}: ${err}`
            );
          }
        }
      } catch (err) {
        logger.error(`[uazapi-sync] tick falhou: ${err}`);
      }
    },
    { scheduled: false } as any
  );

  job.start();
  logger.info(
    "[uazapi-sync] job iniciado — polling de /instance/status a cada 30s"
  );
};
