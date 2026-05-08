import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export interface DeleteMessageParams {
  /** ID da mensagem a ser deletada (revoke for everyone). */
  id: string;
}

/**
 * POST /message/delete — deleta mensagem para todos (revoke).
 *
 * Substitui wbot.sendMessage(jid, { delete: { ... } }) da Baileys.
 */
const DeleteMessage = async (
  whatsapp: Whatsapp,
  params: DeleteMessageParams
): Promise<{ ok: boolean }> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/message/delete", params);
  return res.data;
};

export default DeleteMessage;
