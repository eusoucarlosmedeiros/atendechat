import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";
import { SendMessageResponse } from "./SendText";

export interface SendReactParams {
  /** Numero/JID do chat onde a mensagem original existe. */
  number: string;
  /** ID da mensagem alvo da reacao. */
  id: string;
  /**
   * Emoji Unicode (ex.: "👍", "❤️"). String vazia "" para REMOVER reacao
   * existente. Mensagens com mais de 7 dias nao podem receber reacao.
   */
  text: string;
}

/**
 * POST /message/react — reage a uma mensagem com emoji.
 */
const SendReact = async (
  whatsapp: Whatsapp,
  params: SendReactParams
): Promise<SendMessageResponse> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/message/react", params);
  return res.data;
};

export default SendReact;
