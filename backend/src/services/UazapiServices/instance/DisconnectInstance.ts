import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

/**
 * POST /instance/disconnect — encerra a sessao do WhatsApp da instancia.
 *
 * Apos este chamado, a instancia entra em estado "disconnected" e exige
 * novo /instance/connect (com QR ou pair code) para reconectar.
 */
const DisconnectInstance = async (whatsapp: Whatsapp): Promise<void> => {
  const client = getUazapiClient(whatsapp);
  await client.post("/instance/disconnect", {});
};

export default DisconnectInstance;
