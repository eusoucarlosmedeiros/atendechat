import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export type PresenceType = "composing" | "recording" | "paused";

export interface SendPresenceParams {
  /** JID/numero do destinatario. */
  number: string;
  /**
   * Tipo de presenca (composing/recording/paused).
   * NOTA: spec uazapi usa `presence`, nao `type` — o nome `type` que eu
   * havia usado fazia o backend ignorar o campo.
   */
  presence: PresenceType;
  /**
   * Duracao em ms (max 300000 = 5min). Default 5min se omitido.
   * NOTA: spec usa `delay`, nao `duration`.
   */
  delay?: number;
}

/**
 * POST /message/presence — envia atualizacao de presenca (digitando,
 * gravando audio, etc) ao destinatario, de forma assincrona.
 *
 * Spec: uazapi-openapi-spec.yaml linhas 4530-4609.
 */
const SendPresence = async (
  whatsapp: Whatsapp,
  params: SendPresenceParams
): Promise<{ ok?: boolean }> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/message/presence", params);
  return res.data;
};

export default SendPresence;
