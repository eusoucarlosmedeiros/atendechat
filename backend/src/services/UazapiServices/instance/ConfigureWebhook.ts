import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export type WebhookEventType =
  | "messages"
  | "messages_update"
  | "connection"
  | "call"
  | "contacts"
  | "presence"
  | "groups"
  | "history"
  | "labels"
  | "chats"
  | "chat_labels"
  | "blocks"
  | "leads"
  | "sender";

export type WebhookExcludeFilter =
  | "wasSentByApi"
  | "wasNotSentByApi"
  | "fromMeYes"
  | "fromMeNo"
  | "isGroupYes"
  | "isGroupNo";

export interface ConfigureWebhookParams {
  url: string;
  events: WebhookEventType[];
  excludeMessages?: WebhookExcludeFilter[];
  enabled?: boolean;
  addUrlEvents?: boolean;
  addUrlTypesMessages?: boolean;
}

/**
 * POST /webhook — configura/atualiza o webhook da instancia.
 *
 * IMPORTANTE: passar `excludeMessages: ["wasSentByApi"]` para evitar loop
 * (mensagens que nos mesmos enviamos via uazapi nao retornam ao webhook).
 */
const ConfigureWebhook = async (
  whatsapp: Whatsapp,
  params: ConfigureWebhookParams
): Promise<{ ok: boolean }> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/webhook", params);
  return res.data;
};

export default ConfigureWebhook;
