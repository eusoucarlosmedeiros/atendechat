import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export interface GetGroupInfoParams {
  /** ID do grupo (pode ser <id>@g.us ou apenas <id>). */
  groupId: string;
}

export interface GroupParticipant {
  jid: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  pushName?: string;
}

export interface GroupInfo {
  id: string;
  subject: string;
  description?: string;
  owner?: string;
  participants?: GroupParticipant[];
  inviteCode?: string;
  inviteUrl?: string;
  announce?: boolean;
  locked?: boolean;
  creation?: number;
  [key: string]: any;
}

/**
 * POST /group/info — info completa do grupo (participantes, configuracao,
 * link convite).
 */
const GetGroupInfo = async (
  whatsapp: Whatsapp,
  params: GetGroupInfoParams
): Promise<GroupInfo> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/group/info", params);
  return res.data;
};

export default GetGroupInfo;
