import Whatsapp from "../../models/Whatsapp";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";

/**
 * Handler do evento `connection` — atualiza Whatsapp.status conforme
 * o estado reportado pela uazapi e propaga via socket.io para o frontend
 * (mesmo canal que o codigo Baileys ja usava — sem mudanca no front).
 *
 * Estados uazapi → status interno:
 *   "connected"     → "CONNECTED"
 *   "qrcode" / "qr" → "qrcode"
 *   "connecting"    → "OPENING"
 *   "disconnected"  → "DISCONNECTED"
 *
 * Quando conecta, limpa qrcode e zera retries. Quando vai para qrcode,
 * propaga o codigo (campo `qrcode`).
 */
const handleConnection = async (
  payload: any,
  whatsapp: Whatsapp
): Promise<void> => {
  const upstream: string =
    payload.status || payload.state || payload.connection || "unknown";

  let nextStatus = whatsapp.status;
  const updates: any = {};

  switch (upstream.toLowerCase()) {
    case "connected":
    case "open":
      nextStatus = "CONNECTED";
      updates.status = "CONNECTED";
      updates.qrcode = "";
      updates.retries = 0;
      break;
    case "qrcode":
    case "qr":
      nextStatus = "qrcode";
      updates.status = "qrcode";
      if (payload.qrcode) updates.qrcode = payload.qrcode;
      break;
    case "connecting":
      nextStatus = "OPENING";
      updates.status = "OPENING";
      break;
    case "disconnected":
    case "close":
      nextStatus = "DISCONNECTED";
      updates.status = "DISCONNECTED";
      break;
    default:
      logger.warn(`[uazapi] connection event status desconhecido: ${upstream}`);
      return;
  }

  await whatsapp.update(updates);
  await whatsapp.reload();

  const io = getIO();
  io.to(`company-${whatsapp.companyId}-mainchannel`).emit(
    `company-${whatsapp.companyId}-whatsappSession`,
    { action: "update", session: whatsapp }
  );

  logger.info(
    `[uazapi] connection wid=${whatsapp.id}: ${upstream} -> ${nextStatus}`
  );
};

export default handleConnection;
