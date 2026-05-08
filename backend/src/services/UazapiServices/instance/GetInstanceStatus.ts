import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";
import { UazapiInstance } from "./InitInstance";

/**
 * Resposta REAL do GET /instance/status (uazapi spec).
 *   - `instance.qrcode`: QR atualizado (quando em connecting)
 *   - `instance.paircode`: pair-code (quando aplicavel)
 *   - `instance.status`: disconnected | connecting | connected
 *   - `status.connected`: bool de conexao com WhatsApp
 *   - `status.loggedIn`: bool de auth
 */
export interface InstanceStatusResponse {
  instance: UazapiInstance;
  status: {
    connected: boolean;
    loggedIn: boolean;
    jid: any | null;
  };
}

/**
 * GET /instance/status — info atualizada da instancia.
 *
 * Use em polling apos /instance/connect para obter o QR quando ele
 * nao vier imediatamente na resposta do connect.
 */
const GetInstanceStatus = async (
  whatsapp: Whatsapp
): Promise<InstanceStatusResponse> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.get("/instance/status");
  return res.data;
};

export default GetInstanceStatus;
