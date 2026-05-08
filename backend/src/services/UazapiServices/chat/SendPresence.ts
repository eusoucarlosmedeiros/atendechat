import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export type PresenceType = "composing" | "recording" | "paused";

export interface SendPresenceParams {
  number: string;
  type: PresenceType;
  /**
   * Duracao em ms — max 300000 (5min). uazapi reenvia a cada 10s.
   * Cancela automaticamente ao enviar mensagem.
   */
  duration?: number;
}

/**
 * POST /message/presence — envia estado "Digitando..." / "Gravando audio..."
 * / "Parou" ao destinatario.
 *
 * Substitui wbot.presenceSubscribe + wbot.sendPresenceUpdate da Baileys.
 */
const SendPresence = async (
  whatsapp: Whatsapp,
  params: SendPresenceParams
): Promise<{ ok: boolean }> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/message/presence", params);
  return res.data;
};

export default SendPresence;
