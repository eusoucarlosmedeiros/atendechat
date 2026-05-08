import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export interface ConnectInstanceParams {
  /**
   * Telefone E.164 (ex.: 5511999999999) — quando informado, gera
   * pair-code (8 digitos, validade 5min) em vez de QR code.
   * Quando ausente, gera QR code (validade 2min).
   */
  phone?: string;
}

export interface ConnectInstanceResponse {
  qrcode?: string;   // base64 do QR code (data URL ou string base64)
  pairCode?: string; // codigo de pareamento (8 digitos)
  connected?: boolean;
  status?: string;
  instance?: any;
}

/**
 * POST /instance/connect — inicia o handshake com o WhatsApp para a
 * instancia em questao. Retorna QR code OU pair code dependendo dos
 * params. Quando a sessao ja esta conectada, retorna `connected: true`.
 */
const ConnectInstance = async (
  whatsapp: Whatsapp,
  params: ConnectInstanceParams = {}
): Promise<ConnectInstanceResponse> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/instance/connect", params);
  return res.data;
};

export default ConnectInstance;
