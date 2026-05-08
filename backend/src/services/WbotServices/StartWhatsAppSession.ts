import crypto from "crypto";
import * as Sentry from "@sentry/node";

import Whatsapp from "../../models/Whatsapp";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";

import InitInstance from "../UazapiServices/instance/InitInstance";
import ConnectInstance from "../UazapiServices/instance/ConnectInstance";
import DisconnectInstance from "../UazapiServices/instance/DisconnectInstance";
import ConfigureWebhook from "../UazapiServices/instance/ConfigureWebhook";

/**
 * StartWhatsAppSession (uazapi) — substitui o initWASocket da Baileys.
 *
 * Etapas:
 *   1. Garante que a instancia exista na uazapi (POST /instance/init via
 *      admintoken). Persiste id+token em Whatsapp.uazapi*.
 *   2. Configura webhook (POST /webhook) apontando para nosso backend
 *      em https://<UAZAPI_WEBHOOK_BASE_URL>/uazapi/webhook/<secret>.
 *   3. Conecta (POST /instance/connect) — retorna QR base64 OU pair code.
 *   4. Atualiza Whatsapps.status + qrcode + emite socket.io.
 *
 * Em caso de falha apos init bem-sucedido, faz rollback: chama
 * DisconnectInstance e zera os campos uazapi para evitar estado
 * inconsistente (instancia criada mas webhook ausente -> mensagens
 * chegariam sem nosso backend escutar).
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
    // 1. Garantir instancia
    if (!whatsapp.uazapiInstanceId || !whatsapp.uazapiToken) {
      const init = await InitInstance({ name: whatsapp.name });
      await whatsapp.update({
        uazapiInstanceId: init.id,
        uazapiToken: init.token,
        uazapiBaseUrl: process.env.UAZAPI_BASE_URL || null,
        uazapiWebhookSecret: crypto.randomBytes(16).toString("hex")
      });
      await whatsapp.reload();
    }

    if (!whatsapp.uazapiWebhookSecret) {
      await whatsapp.update({
        uazapiWebhookSecret: crypto.randomBytes(16).toString("hex")
      });
      await whatsapp.reload();
    }

    // 2. Configurar webhook (idempotente)
    // BACKEND_URL ja existe no .env do projeto — reusamos como base.
    const webhookBase = process.env.BACKEND_URL;
    if (!webhookBase) {
      throw new Error("BACKEND_URL nao configurado em .env");
    }
    const webhookUrl = `${webhookBase.replace(/\/$/, "")}/uazapi/webhook/${whatsapp.uazapiWebhookSecret}`;
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
      excludeMessages: ["wasSentByApi"], // critico — evita loop
      enabled: true
    });

    // 3. Conectar — retorna QR ou ja conecta direto se sessao for valida
    const connectRes = await ConnectInstance(whatsapp);

    if (connectRes.connected) {
      await whatsapp.update({
        status: "CONNECTED",
        qrcode: "",
        retries: 0
      });
    } else if (connectRes.qrcode) {
      await whatsapp.update({
        status: "qrcode",
        qrcode: connectRes.qrcode
      });
    } else {
      // estado intermediario (connecting): handleConnection vai reconciliar
      // quando o evento de connection chegar via webhook.
      await whatsapp.update({ status: "OPENING" });
    }

    await whatsapp.reload();
    emitUpdate();

    logger.info(
      `[uazapi] StartWhatsAppSession ok wid=${whatsapp.id} status=${whatsapp.status}`
    );
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`[uazapi] StartWhatsAppSession falhou wid=${whatsapp.id}: ${err}`);

    // Rollback: se ja temos instancia inicializada mas falhou em webhook ou
    // connect, melhor desligar a instancia e zerar para tentar de novo
    // do zero na proxima.
    try {
      if (whatsapp.uazapiInstanceId && whatsapp.uazapiToken) {
        try { await DisconnectInstance(whatsapp); } catch (_) { /* noop */ }
      }
    } catch (_) { /* swallow rollback errors */ }

    await whatsapp.update({
      status: "DISCONNECTED",
      qrcode: ""
    });
    emitUpdate();
  }
};
