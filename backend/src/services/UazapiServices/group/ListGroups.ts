import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";
import { GroupInfo } from "./GetGroupInfo";

/**
 * GET /group/list — lista todos os grupos da instancia.
 */
const ListGroups = async (whatsapp: Whatsapp): Promise<GroupInfo[]> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.get("/group/list");
  return res.data;
};

export default ListGroups;
