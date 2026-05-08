import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export interface ChatDetailsParams {
  number: string;
}

export interface ChatDetailsResponse {
  jid?: string;
  number?: string;
  contactName?: string;
  pushName?: string;
  profilePicUrl?: string;
  isGroup?: boolean;
  isBusiness?: boolean;
  // ...60+ campos no spec; tipamos so os essenciais
  [key: string]: any;
}

/**
 * POST /chat/details — info completa do chat (60+ campos).
 *
 * Util para substituir wbot.profilePictureUrl(jid) — o profilePicUrl vem
 * neste payload.
 */
const ChatDetails = async (
  whatsapp: Whatsapp,
  params: ChatDetailsParams
): Promise<ChatDetailsResponse> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/chat/details", params);
  return res.data;
};

export default ChatDetails;
