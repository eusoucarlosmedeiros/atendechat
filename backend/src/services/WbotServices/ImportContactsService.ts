import * as Sentry from "@sentry/node";
import { isArray } from "lodash";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import Contact from "../../models/Contact";
import { logger } from "../../utils/logger";
import CreateContactService from "../ContactServices/CreateContactService";
import ListContacts from "../UazapiServices/chat/ListContacts";

/**
 * Importa contatos da uazapi para a base local.
 * Substitui o uso de ShowBaileysService (cache Baileys) que sera dropado
 * na 01.08.
 */
const ImportContactsService = async (companyId: number): Promise<void> => {
  const defaultWhatsapp = await GetDefaultWhatsApp(companyId);

  let uazapiContacts: any[] = [];
  try {
    uazapiContacts = await ListContacts(defaultWhatsapp);
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`ImportContactsService: erro ao listar contatos uazapi: ${err}`);
    return;
  }

  if (!isArray(uazapiContacts)) {
    logger.warn("ImportContactsService: resposta uazapi nao e array");
    return;
  }

  for (const c of uazapiContacts) {
    try {
      const jid: string = c.jid || c.id || "";
      if (!jid || jid === "status@broadcast" || jid.includes("g.us")) continue;

      const number = jid.replace(/\D/g, "");
      if (!number) continue;
      const name = c.contactName || c.contact_FirstName || c.pushName || number;

      const existing = await Contact.findOne({ where: { number, companyId } });
      if (existing) {
        if (existing.name !== name) {
          existing.name = name;
          await existing.save();
        }
      } else {
        await CreateContactService({ number, name, companyId });
      }
    } catch (err) {
      Sentry.captureException(err);
      logger.warn(`ImportContactsService: contato falhou: ${err}`);
    }
  }
};

export default ImportContactsService;
