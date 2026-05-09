import Whatsapp from "../../models/Whatsapp";
import AppError from "../../errors/AppError";
import DeleteInstance from "../UazapiServices/instance/DeleteInstance";
import { logger } from "../../utils/logger";

/**
 * Delete bidirecional: ao excluir um Whatsapp do painel Atendechat,
 * a instancia correspondente tambem e removida na uazapi (libera
 * slot do plano).
 *
 * Sequencia:
 *   1. Carrega o Whatsapp (404 se nao existir)
 *   2. Se tem credenciais uazapi populadas, tenta DELETE /instance
 *      (nao bloqueia em caso de falha — instancia pode ja nao existir
 *      la, ou pode estar offline)
 *   3. Remove do banco local
 */
const DeleteWhatsAppService = async (id: string): Promise<void> => {
  const whatsapp = await Whatsapp.findOne({ where: { id } });

  if (!whatsapp) {
    throw new AppError("ERR_NO_WAPP_FOUND", 404);
  }

  // Tenta apagar na uazapi primeiro. Se falhar, segue com o delete
  // local mesmo assim — o admin pode estar limpando lixo orfao.
  if (whatsapp.uazapiInstanceId && whatsapp.uazapiToken) {
    try {
      await DeleteInstance(whatsapp);
      logger.info(
        `[uazapi] instancia deletada wid=${whatsapp.id} uazapiId=${whatsapp.uazapiInstanceId}`
      );
    } catch (err: any) {
      // 404 = ja nao existia la, OK; outros = log warn e continua
      const status = err?.originalError?.response?.status;
      if (status === 404) {
        logger.info(
          `[uazapi] instancia ja nao existia na uazapi wid=${whatsapp.id} (404, ok)`
        );
      } else {
        logger.warn(
          `[uazapi] DeleteInstance falhou wid=${whatsapp.id}: ${err?.message || err}. ` +
          `Removendo do banco local mesmo assim.`
        );
      }
    }
  }

  await whatsapp.destroy();
};

export default DeleteWhatsAppService;
