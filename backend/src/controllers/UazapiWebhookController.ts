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

  // A uazapi pode envelopar o payload de varias formas. Tentamos achar
  // tanto o id da mensagem/evento quanto o tipo de evento em multiplos
  // locais conhecidos. Se mesmo assim falhar, logamos o payload bruto
  // para facilitar debug e seguimos com defaults razoaveis.
  const extractEventType = (b: any): string => {
    const candidates = [
      b.event,
      b.EventType,
      b.event_type,
      b.eventType,
      b.type,
      b.action
    ].filter(v => typeof v === "string");
    if (candidates[0]) return candidates[0];
    // heuristic: olha o nome da chave no envelope
    if (b.messages || b.message) return "messages";
    if (b.connection || b.status) return "connection";
    if (b.call) return "call";
    if (b.contacts || b.contact) return "contacts";
    if (b.presence) return "presence";
    return "unknown";
  };

  const extractEventId = (b: any, evt: string): string | undefined => {
    // Para messages/messages_update: spec uazapi expoe `messageid`
    // (ID original WhatsApp) e `id` (ID interno uazapi) DENTRO de
    // `b.message`. Idempotencia ideal: messageid (estavel entre re-syncs).
    if ((evt === "messages" || evt === "messages_update") && b.message && typeof b.message === "object") {
      const m: any = b.message;
      if (m.messageid) return String(m.messageid);
      if (m.id) return String(m.id);
    }
    // Outros eventos: top-level e fallbacks
    const tryFields = (obj: any) => {
      if (!obj || typeof obj !== "object") return undefined;
      return obj.id || obj.event_id || obj.eventId || obj.message_id || obj.messageId || obj.messageid;
    };
    let id = tryFields(b);
    if (id) return String(id);
    id = tryFields(b.data) || tryFields(b.payload) || tryFields(b.message) || tryFields(b.event);
    if (id) return String(id);
    if (Array.isArray(b.messages) && b.messages[0]) {
      id = tryFields(b.messages[0]);
      if (id) return String(id);
    }
    if (Array.isArray(b.contacts) && b.contacts[0]) {
      id = tryFields(b.contacts[0]) || b.contacts[0].jid || b.contacts[0].number;
      if (id) return `${evt}:${id}:${b.contacts[0].timestamp || Date.now()}`;
    }
    return undefined;
  };

  const eventType = extractEventType(body);
  let uazapiEventId = extractEventId(body, eventType);

  if (!uazapiEventId) {
    // Sem id estavel, ainda processamos — geramos id sintetico baseado em
    // hash do payload + timestamp para preservar idempotencia.
    const synthetic = `${eventType}:${whatsapp.id}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    uazapiEventId = synthetic;
    logger.warn(
      `[uazapi-webhook] payload sem id estavel wid=${whatsapp.id} evt=${eventType} ` +
      `synth=${synthetic} payload=${JSON.stringify(body).slice(0, 600)}`
    );
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
