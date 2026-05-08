import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";

/**
 * Handler do evento `presence` — log only por enquanto.
 *
 * O sistema atual nao usa presenca (online/offline/typing) em nenhum
 * fluxo de negocio. Mantemos o handler stubado para nao perder o evento
 * no router (e poder evoluir caso queira mostrar "online agora" no UI).
 */
const handlePresence = async (
  payload: any,
  whatsapp: Whatsapp
): Promise<void> => {
  logger.debug(
    `[uazapi] presence wid=${whatsapp.id}: ${payload.from || payload.user || "?"} -> ${payload.presence || payload.status || "?"}`
  );
};

export default handlePresence;
