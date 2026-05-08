import { getIO } from "../../libs/socket";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";
import { isNil } from "lodash";
interface ExtraInfo extends ContactCustomField {
  name: string;
  value: string;
}

interface Request {
  name: string;
  number: string;
  isGroup: boolean;
  email?: string;
  profilePicUrl?: string;
  companyId: number;
  extraInfo?: ExtraInfo[];
  whatsappId?: number;
  // Locally Identifiable Device do WhatsApp (so a parte numerica, sem @lid).
  // Quando setado, e persistido para que SendWhatsApp* possam usar como
  // destinatario quando o telefone real (number) nao for confiavel.
  lid?: string;
}

const CreateOrUpdateContactService = async ({
  name,
  number: rawNumber,
  profilePicUrl,
  isGroup,
  email = "",
  companyId,
  extraInfo = [],
  whatsappId,
  lid
}: Request): Promise<Contact> => {
  const number = isGroup ? rawNumber : rawNumber.replace(/[^0-9]/g, "");
  const cleanLid = lid ? lid.replace(/\D/g, "") : undefined;

  const io = getIO();
  let contact: Contact | null;

  // 1) Tenta achar por number; 2) se nao, tenta por lid (caso o contato
  //    tenha sido criado anteriormente sem PN conhecido).
  contact = await Contact.findOne({ where: { number, companyId } });
  if (!contact && cleanLid) {
    contact = await Contact.findOne({ where: { lid: cleanLid, companyId } });
  }

  if (contact) {
    const updates: Partial<Contact> = { profilePicUrl };
    if (cleanLid && contact.lid !== cleanLid) {
      updates.lid = cleanLid;
    }
    // Se chegou um number "real" e o contato estava com number = LID, atualiza.
    if (!isGroup && contact.number !== number && /^\d{8,15}$/.test(number)) {
      updates.number = number;
    }
    if (isNil(contact.whatsappId === null)) {
      updates.whatsappId = whatsappId;
    }
    await contact.update(updates);
    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-contact`, {
      action: "update",
      contact
    });
  } else {
    contact = await Contact.create({
      name,
      number,
      profilePicUrl,
      email,
      isGroup,
      extraInfo,
      companyId,
      whatsappId,
      lid: cleanLid
    });

    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-contact`, {
      action: "create",
      contact
    });
  }

  return contact;
};

export default CreateOrUpdateContactService;
