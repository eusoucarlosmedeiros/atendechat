import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export interface ReadChatParams {
  number: string;
  /** Quando true, marca todas as mensagens nao lidas. Default: true. */
  readAll?: boolean;
}

/**
 * POST /chat/read — marca mensagens como lidas (envia "visto" ao remetente).
 *
 * Substitui wbot.chatModify({ markRead: true, lastMessages }) da Baileys.
 */
const ReadChat = async (
  whatsapp: Whatsapp,
  params: ReadChatParams
): Promise<{ ok: boolean }> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/chat/read", params);
  return res.data;
};

export default ReadChat;
