import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export interface ReadChatParams {
  /**
   * JID do chat:
   *   - 1:1: <num>@s.whatsapp.net
   *   - Grupo: <id>@g.us
   */
  number: string;
  /**
   * true  -> marca como lido (zera contador, envia "visto")
   * false -> marca como nao lido
   * Default: true
   *
   * IMPORTANTE: nome correto e `read`, nao `readAll`. O parametro
   * `readAll` nao existe no spec da uazapi e fazia o endpoint
   * retornar 500.
   */
  read?: boolean;
}

/**
 * POST /chat/read — marca chat como lido/nao lido.
 * Spec: uazapi-openapi-spec.yaml linhas 11189-11244.
 */
const ReadChat = async (
  whatsapp: Whatsapp,
  params: ReadChatParams
): Promise<{ response?: string }> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/chat/read", {
    number: params.number,
    read: params.read ?? true
  });
  return res.data;
};

export default ReadChat;
