import { Op } from "sequelize";
import WebhookEvent from "../models/WebhookEvent";
import { logger } from "../utils/logger";

const CronJob = require("cron").CronJob;

const RETENTION_DAYS = Number(process.env.WEBHOOK_EVENTS_RETENTION_DAYS || 30);

/**
 * Job de limpeza dos WebhookEvents acumulados.
 *
 * Roda diariamente as 03:00 (horario do servidor) e remove eventos com
 * `processedAt` mais antigo que RETENTION_DAYS dias (default 30).
 *
 * Definido em modulo separado para nao poluir queues.ts (que e Bull) —
 * este e simplesmente um cron node.
 */
export const startWebhookEventsCleanup = (): void => {
  const job = new CronJob(
    "0 3 * * *", // todos os dias as 03:00
    async () => {
      try {
        const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const deleted = await WebhookEvent.destroy({
          where: { processedAt: { [Op.lt]: cutoff } }
        });
        if (deleted > 0) {
          logger.info(
            `[cleanup] WebhookEvents: ${deleted} linhas removidas (>${RETENTION_DAYS}d)`
          );
        }
      } catch (err) {
        logger.error(`[cleanup] WebhookEvents falhou: ${err}`);
      }
    },
    null,
    true,
    "America/Sao_Paulo"
  );

  job.start();
  logger.info(
    `[cleanup] WebhookEvents cron registrado (retencao=${RETENTION_DAYS}d, exec=03:00 BRT)`
  );
};
