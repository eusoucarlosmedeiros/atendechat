import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export interface UazapiContact {
  jid: string;
  contactName?: string;
  contact_FirstName?: string;
  pushName?: string;
  profilePicUrl?: string;
  isBusiness?: boolean;
  number?: string;
}

/**
 * GET /contacts — lista todos os contatos sincronizados pela uazapi.
 *
 * Para volumes grandes, prefira a versao paginada via POST /contacts/list
 * (a ser adicionada se houver demanda — uazapi suporta {page, pageSize}).
 */
const ListContacts = async (whatsapp: Whatsapp): Promise<UazapiContact[]> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.get("/contacts");
  return res.data;
};

export default ListContacts;
