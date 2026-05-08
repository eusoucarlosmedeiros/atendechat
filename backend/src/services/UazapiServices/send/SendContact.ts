import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";
import { SendMessageResponse } from "./SendText";

export interface SendContactParams {
  number: string;
  fullName: string;
  phoneNumber: string;   // separados por virgula se multiplos
  organization?: string;
  email?: string;
  url?: string;
  replyid?: string;
}

/**
 * POST /send/contact — envia vCard (cartao de contato clicavel).
 */
const SendContact = async (
  whatsapp: Whatsapp,
  params: SendContactParams
): Promise<SendMessageResponse> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/send/contact", params);
  return res.data;
};

export default SendContact;
