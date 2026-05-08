import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export interface InstanceStatusResponse {
  status: string;             // disconnected | connecting | connected | qrcode
  qrcode?: string;
  profileName?: string;
  profilePicUrl?: string;
  isBusiness?: boolean;
  platform?: string;
  owner?: string;
  battery?: number;
  plugged?: boolean;
}

/**
 * GET /instance/status — consulta status da instancia + QR atualizado se
 * estiver no estado "qrcode". Util para polling apos /instance/connect.
 */
const GetInstanceStatus = async (
  whatsapp: Whatsapp
): Promise<InstanceStatusResponse> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.get("/instance/status");
  return res.data;
};

export default GetInstanceStatus;
