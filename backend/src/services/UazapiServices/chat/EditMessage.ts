import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export interface EditMessageParams {
  id: string;
  text: string;
}

/**
 * POST /message/edit — edita texto de uma mensagem ja enviada.
 *
 * Sujeito as restricoes do WhatsApp (mensagens com mais de 15 minutos
 * nao podem ser editadas).
 */
const EditMessage = async (
  whatsapp: Whatsapp,
  params: EditMessageParams
): Promise<{ ok: boolean }> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/message/edit", params);
  return res.data;
};

export default EditMessage;
