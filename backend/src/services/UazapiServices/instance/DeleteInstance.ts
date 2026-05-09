import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

/**
 * DELETE /instance — remove a instancia do sistema uazapi.
 *
 * Difere de DisconnectInstance: o disconnect mantem a instancia
 * cadastrada (em estado disconnected), enquanto o delete remove
 * completamente. Use quando o admin do Atendechat exclui um
 * Whatsapp do painel — assim a instancia tambem some la na uazapi
 * (libera slot do plano).
 */
const DeleteInstance = async (whatsapp: Whatsapp): Promise<void> => {
  const client = getUazapiClient(whatsapp);
  await client.delete("/instance");
};

export default DeleteInstance;
