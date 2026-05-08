import { Request, Response } from "express";
import ShowWhatsAppService from "../services/WhatsappService/ShowWhatsAppService";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import UpdateWhatsAppService from "../services/WhatsappService/UpdateWhatsAppService";
import DisconnectInstance from "../services/UazapiServices/instance/DisconnectInstance";
import { logger } from "../utils/logger";

const store = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);
  // nao aguarda — start e fire-and-forget; status vai chegar via socket.io
  StartWhatsAppSession(whatsapp, companyId).catch(err =>
    logger.error(`StartWhatsAppSession async erro wid=${whatsapp.id}: ${err}`)
  );

  return res.status(200).json({ message: "Starting session." });
};

const update = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  // Reset da sessao: limpa session legacy E forca re-conexao na uazapi.
  // Mantemos uazapiInstanceId/Token para reaproveitar a instancia ja
  // criada — apenas reabrimos a conexao (novo QR se preciso).
  const { whatsapp } = await UpdateWhatsAppService({
    whatsappId,
    companyId,
    whatsappData: { session: "" }
  });

  StartWhatsAppSession(whatsapp, companyId).catch(err =>
    logger.error(`StartWhatsAppSession (update) async erro wid=${whatsapp.id}: ${err}`)
  );

  return res.status(200).json({ message: "Starting session." });
};

const remove = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;
  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);

  if (whatsapp.uazapiInstanceId && whatsapp.uazapiToken) {
    try {
      await DisconnectInstance(whatsapp);
    } catch (err) {
      logger.warn(`DisconnectInstance falhou wid=${whatsapp.id}: ${err}`);
    }
  }

  await whatsapp.update({ status: "DISCONNECTED", session: "", qrcode: "" });
  return res.status(200).json({ message: "Session disconnected." });
};

export default { store, remove, update };
