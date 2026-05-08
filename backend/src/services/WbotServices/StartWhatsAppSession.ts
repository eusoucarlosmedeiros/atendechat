import crypto from "crypto";
import * as Sentry from "@sentry/node";

import Whatsapp from "../../models/Whatsapp";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";

import InitInstance from "../UazapiServices/instance/InitInstance";
import ConnectInstance from "../UazapiServices/instance/ConnectInstance";
import DisconnectInstance from "../UazapiServices/instance/DisconnectInstance";
import GetInstanceStatus from "../UazapiServices/instance/GetInstanceStatus";
import ConfigureWebhook from "../UazapiServices/instance/ConfigureWebhook";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * StartWhatsAppSession (uazapi) — substitui o initWASocket da Baileys.
 *
 * Etapas:
 *   1. Garante que a instancia exista na uazapi (POST /instance/init via
 *      admintoken). Persiste id+token em Whatsapp.uazapi*.
 *   2. Configura webhook (POST /webhook).
 *   3. Conecta (POST /instance/connect). O QR pode estar na resposta
 *      (instance.qrcode) OU vir depois — neste caso, fazemos polling de
 *      /instance/status por ate 30s para capturar o QR atualizado.
 *   4. Atualiza Whatsapps + emite socket.io.
 *
 * Em caso de falha apos init, faz rollback (DisconnectInstance) para
 * evitar estado inconsistente.
 */
export const StartWhatsAppSession = async (
  whatsapp: Whatsapp,
  companyId: number
): Promise<void> => {
  await whatsapp.update({ status: "OPENING" });

  const io = getIO();
  const emitUpdate = () => {
    io.to(`company-${whatsapp.companyId}-mainchannel`).emit(
      `company-${whatsapp.companyId}-whatsappSession`,
      { action: "update", session: whatsapp }
    );
  };
  emitUpdate();

  try {
    // 1. Garantir instancia uazapi
    if (!whatsapp.uazapiInstanceId || !whatsapp.uazapiToken) {
      logger.info(`[uazapi] criando instancia para wid=${whatsapp.id} (${whatsapp.name})`);
      const init = await InitInstance({ name: whatsapp.name });
      // Atencao: spec uazapi diz que `id` esta em `instance.id` e `token`
      // tanto em top-level quanto em instance.token. Usamos os top-level
      // mais o instance.id.
      await whatsapp.update({
        uazapiInstanceId: init.instance?.id || (init as any).id,
        uazapiToken: init.token || init.instance?.token,
        uazapiBaseUrl: process.env.UAZAPI_BASE_URL || null,
        uazapiWebhookSecret: crypto.randomBytes(16).toString("hex")
      });
      await whatsapp.reload();
      logger.info(`[uazapi] instancia criada wid=${whatsapp.id} uazapiInstanceId=${whatsapp.uazapiInstanceId}`);
    }

    if (!whatsapp.uazapiWebhookSecret) {
      await whatsapp.update({
        uazapiWebhookSecret: crypto.randomBytes(16).toString("hex")
      });
      await whatsapp.reload();
    }

    // 2. Configurar webhook
    const webhookBase = process.env.BACKEND_URL;
    if (!webhookBase) {
      throw new Error("BACKEND_URL nao configurado em .env");
    }
    const webhookUrl = `${webhookBase.replace(/\/$/, "")}/uazapi/webhook/${whatsapp.uazapiWebhookSecret}`;
    logger.info(`[uazapi] configurando webhook wid=${whatsapp.id} url=${webhookUrl}`);
    await ConfigureWebhook(whatsapp, {
      url: webhookUrl,
      events: [
        "messages",
        "messages_update",
        "connection",
        "call",
        "contacts",
        "presence"
      ],
      excludeMessages: ["wasSentByApi"],
      enabled: true
    });

    // 3. Conectar
    logger.info(`[uazapi] /instance/connect wid=${whatsapp.id}`);
    const connectRes = await ConnectInstance(whatsapp);
    let qrcode = connectRes.instance?.qrcode;
    let upstreamStatus = connectRes.instance?.status || "connecting";
    const isConnected = connectRes.connected || upstreamStatus === "connected";

    // 4. Polling de fallback: se /connect retornou sem QR e nao esta
    // conectado, faz polling de /instance/status ate 30s para pegar o QR.
    if (!isConnected && !qrcode) {
      logger.info(`[uazapi] aguardando QR via polling /instance/status wid=${whatsapp.id}`);
      for (let i = 0; i < 15; i++) {
        await sleep(2000);
        try {
          const statusRes = await GetInstanceStatus(whatsapp);
          qrcode = statusRes.instance?.qrcode;
          upstreamStatus = statusRes.instance?.status || upstreamStatus;
          if (qrcode || statusRes.status?.connected) {
            logger.info(`[uazapi] QR/connected obtido apos ${(i + 1) * 2}s wid=${whatsapp.id}`);
            break;
          }
        } catch (err) {
          logger.warn(`[uazapi] polling status falhou (tentativa ${i + 1}): ${err}`);
        }
      }
    }

    // 5. Persistir e propagar
    if (isConnected || upstreamStatus === "connected") {
      await whatsapp.update({
        status: "CONNECTED",
        qrcode: "",
        retries: 0
      });
    } else if (qrcode) {
      await whatsapp.update({
        status: "qrcode",
        qrcode
      });
    } else {
      await whatsapp.update({ status: "OPENING" });
      logger.warn(
        `[uazapi] sem QR nem connected apos polling — handleConnection ` +
        `via webhook deve reconciliar wid=${whatsapp.id}`
      );
    }

    await whatsapp.reload();
    emitUpdate();

    logger.info(
      `[uazapi] StartWhatsAppSession ok wid=${whatsapp.id} status=${whatsapp.status} hasQr=${!!whatsapp.qrcode}`
    );
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`[uazapi] StartWhatsAppSession falhou wid=${whatsapp.id}: ${err}`);

    try {
      if (whatsapp.uazapiInstanceId && whatsapp.uazapiToken) {
        try { await DisconnectInstance(whatsapp); } catch (_) { /* noop */ }
      }
    } catch (_) { /* swallow */ }

    await whatsapp.update({
      status: "DISCONNECTED",
      qrcode: ""
    });
    emitUpdate();
  }
};
