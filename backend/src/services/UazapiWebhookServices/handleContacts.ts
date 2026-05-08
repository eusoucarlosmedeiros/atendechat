import Whatsapp from "../../models/Whatsapp";
import Contact from "../../models/Contact";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";

/**
 * Handler do evento `contacts` — atualizacao de contato (foto de perfil,
 * pushName, etc). Apenas atualiza contatos ja existentes; nao cria novos
 * (criacao acontece em handleMessages quando o contato manda uma mensagem).
 */
const handleContacts = async (
  payload: any,
  whatsapp: Whatsapp
): Promise<void> => {
  const contacts: any[] = Array.isArray(payload.contacts)
    ? payload.contacts
    : Array.isArray(payload)
    ? payload
    : payload.contact
    ? [payload.contact]
    : [];

  for (const c of contacts) {
    const number = (c.number || c.phoneNumber || c.user || "").replace(/\D/g, "");
    if (!number) continue;

    const contact = await Contact.findOne({
      where: { number, companyId: whatsapp.companyId }
    });
    if (!contact) continue;

    const updates: any = {};
    if (c.profilePicUrl && c.profilePicUrl !== contact.profilePicUrl) {
      updates.profilePicUrl = c.profilePicUrl;
    }
    if (c.pushName && c.pushName !== contact.name) {
      updates.name = c.pushName;
    }

    if (Object.keys(updates).length === 0) continue;

    await contact.update(updates);
    const io = getIO();
    io.to(`company-${whatsapp.companyId}-mainchannel`).emit(
      `company-${whatsapp.companyId}-contact`,
      { action: "update", contact }
    );
  }

  if (contacts.length > 0) {
    logger.debug(`[uazapi] contacts wid=${whatsapp.id}: ${contacts.length} processados`);
  }
};

export default handleContacts;
