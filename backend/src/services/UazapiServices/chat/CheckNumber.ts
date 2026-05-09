import Whatsapp from "../../../models/Whatsapp";
import { getUazapiClient } from "../../../libs/uazapi";

export interface CheckNumberParams {
  /** Numero unico (E.164 ou JID). Internamente vira `numbers: [number]`. */
  number: string;
}

/**
 * Resposta normalizada — retrocompativel com os callers existentes do
 * Atendechat (que esperavam `{ exists, jid }`).
 */
export interface CheckNumberResponse {
  exists: boolean;
  jid?: string;
  lid?: string;
  verifiedName?: string;
  groupName?: string;
}

/**
 * Item bruto retornado pela uazapi (spec linhas 12239-12263).
 */
interface UazapiCheckItem {
  query?: string;
  jid?: string;
  lid?: string;
  isInWhatsapp?: boolean;
  verifiedName?: string;
  groupName?: string;
  error?: string;
}

/**
 * POST /chat/check — verifica se um numero esta no WhatsApp.
 *
 * Spec: uazapi-openapi-spec.yaml linhas 12193-12273.
 *   - Request: `{ numbers: string[] }` (array, NAO singular)
 *   - Response: array de `{ query, jid, lid, isInWhatsapp, verifiedName, ... }`
 *
 * Como os callers existentes consultam um numero por vez, expomos uma
 * API singular (CheckNumberParams.number) e desempacotamos o primeiro
 * resultado do array em CheckNumberResponse.
 */
const CheckNumber = async (
  whatsapp: Whatsapp,
  params: CheckNumberParams
): Promise<CheckNumberResponse> => {
  const client = getUazapiClient(whatsapp);
  const res = await client.post("/chat/check", {
    numbers: [params.number]
  });
  const arr: UazapiCheckItem[] = Array.isArray(res.data) ? res.data : [];
  const first = arr[0] || {};
  return {
    exists: !!first.isInWhatsapp,
    jid: first.jid,
    lid: first.lid,
    verifiedName: first.verifiedName,
    groupName: first.groupName
  };
};

export default CheckNumber;
