import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export interface CheckNumberParams {
  number: string;
}

export interface CheckNumberResponse {
  exists: boolean;
  jid?: string;          // <pn>@s.whatsapp.net se existe
  lid?: string;          // <lid>@lid quando aplicavel
  isBusiness?: boolean;
}

/**
 * POST /chat/check — verifica se um numero esta no WhatsApp.
 *
 * Substitui wbot.onWhatsApp(jid) da Baileys.
 */
const CheckNumber = async (
  whatsapp: Whatsapp,
  params: CheckNumberParams
): Promise<CheckNumberResponse> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/chat/check", params);
  return res.data;
};

export default CheckNumber;
