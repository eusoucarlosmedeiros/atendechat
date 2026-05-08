import { Router } from "express";
import UazapiWebhookController from "../controllers/UazapiWebhookController";

const uazapiWebhookRoutes = Router();

// Endpoint que recebe eventos da uazapi.
// O `secret` na URL e validado contra Whatsapp.uazapiWebhookSecret —
// substitui ausencia de assinatura HMAC do uazapi.
uazapiWebhookRoutes.post(
  "/uazapi/webhook/:secret",
  UazapiWebhookController.handle
);

// Healthcheck para a uazapi (alguns provedores fazem ping na config).
uazapiWebhookRoutes.get(
  "/uazapi/webhook/:secret",
  UazapiWebhookController.healthcheck
);

export default uazapiWebhookRoutes;
