import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";
import { UazapiInstance } from "./InitInstance";

export interface ConnectInstanceParams {
  /**
   * Telefone E.164 (ex.: 5511999999999) — quando informado, gera
   * pair-code (8 digitos, validade 5min) em vez de QR code.
   * Quando ausente, gera QR code (validade 2min).
   */
  phone?: string;
}

/**
 * Resposta REAL do POST /instance/connect (uazapi spec).
 * O QR/paircode estao DENTRO de `instance`, NAO no top-level.
 */
export interface ConnectInstanceResponse {
  connected: boolean;
  loggedIn: boolean;
  jid: any | null;
  instance: UazapiInstance;  // <- aqui mora qrcode, paircode, status
}

/**
 * POST /instance/connect — inicia conexao com o WhatsApp.
 *
 * Importante: o QR pode NAO vir imediatamente. Quando vier, esta em
 * `response.instance.qrcode` (formato `data:image/png;base64,...`).
 * Caso `instance.status === "connecting"` e qrcode vazio, chame
 * GetInstanceStatus em polling para obter o QR atualizado.
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
