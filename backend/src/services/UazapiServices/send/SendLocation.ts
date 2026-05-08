import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";
import { SendMessageResponse } from "./SendText";

export interface SendLocationParams {
  number: string;
  latitude: number;   // -90..90
  longitude: number;  // -180..180
  name?: string;
  address?: string;
  replyid?: string;
}

/**
 * POST /send/location — envia localizacao (mapa interativo no destinatario).
 */
const SendLocation = async (
  whatsapp: Whatsapp,
  params: SendLocationParams
): Promise<SendMessageResponse> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/send/location", params);
  return res.data;
};

export default SendLocation;
