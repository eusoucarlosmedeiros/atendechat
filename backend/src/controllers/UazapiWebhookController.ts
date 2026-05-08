import { Request, Response } from "express";
import { UniqueConstraintError } from "sequelize";
import * as Sentry from "@sentry/node";
import Whatsapp from "../models/Whatsapp";
import WebhookEvent from "../models/WebhookEvent";
import { dispatch } from "../services/UazapiWebhookServices/router";
import { logger } from "../utils/logger";

/**
 * UazapiWebhookController — recebe eventos da uazapi.
 *
 * Regras chave:
 * - URL contem secret unico por instancia (validacao = "auth").
 * - Idempotencia: WebhookEvent.create com UNIQUE (uazapiEventId, whatsappId);
 *   se duplicado, retorna 200 sem reprocessar.
 * - Sempre retorna 200 apos persistir o evento — uazapi nao retentaria mesmo
 *   em 5xx, e o evento ja esta salvo para reprocesso manual.
 * - Erros internos do handler: capturados, reportados em Sentry com tags,
 *   mas NAO propagados (200 e devolvido pra uazapi).
 */

const handle = async (req: Request, res: Response): Promise<Response> => {
  const { secret } = req.params;
  if (!secret) return res.status(401).send("invalid");

  const whatsapp = await Whatsapp.findOne({
    where: { uazapiWebhookSecret: secret }
  });
  if (!whatsapp) {
    logger.warn(`[uazapi-webhook] secret invalido: ${secret.slice(0, 6)}...`);
    return res.status(401).send("invalid");
  }

  const body = req.body || {};
  // A uazapi pode enviar id em campos diferentes dependendo do evento.
  const uazapiEventId =
    body.id || body.event_id || body.eventId || body.message_id || body.messageId;
  const eventType =
    body.event || body.eventType || body.type || "unknown";

  if (!uazapiEventId) {
    logger.warn(
      `[uazapi-webhook] payload sem id wid=${whatsapp.id} evt=${eventType}`
    );
    return res.status(200).send("ok (no id)");
  }

  // 1) Idempotencia
  try {
    await WebhookEvent.create({
      uazapiEventId: String(uazapiEventId),
      eventType: String(eventType),
      whatsappId: whatsapp.id,
      payload: body
    } as any);
  } catch (err: any) {
    if (err instanceof UniqueConstraintError || err?.name === "SequelizeUniqueConstraintError") {
      return res.status(200).send("ok (duplicate)");
    }
    Sentry.captureException(err, {
      tags: { source: "uazapi-webhook", phase: "persist", whatsappId: whatsapp.id }
    });
    logger.error(`[uazapi-webhook] erro ao persistir evento: ${err}`);
    // Mesmo com erro de persistencia, retornamos 200 para nao gerar retry
    // loop da uazapi. O evento sera perdido — investigar via Sentry.
    return res.status(200).send("ok (persist failed, swallowed)");
  }

  // 2) Despachar para handler especifico
  try {
    await dispatch(String(eventType), body, whatsapp);
  } catch (err) {
    Sentry.captureException(err, {
      tags: {
        source: "uazapi-webhook",
        phase: "handler",
        eventType: String(eventType),
        whatsappId: whatsapp.id,
        severity: "high"
      }
    });
    logger.error(
      `[uazapi-webhook] handler erro evt=${eventType} wid=${whatsapp.id}: ${err}`
    );
  }

  return res.status(200).send("ok");
};

const healthcheck = async (req: Request, res: Response): Promise<Response> => {
  // GET no mesmo path: retorna 200 sem expor info se secret valido ou nao.
  return res.status(200).send("ok");
};

export default { handle, healthcheck };
