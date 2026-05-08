/**
 * LidPnResolver
 *
 * Helpers para lidar com a coexistencia de JIDs @lid (Locally Identifiable
 * Device) e @s.whatsapp.net (Phone Number) introduzida pelo WhatsApp em
 * 2024+. A Baileys 6.7.18 expoe AS VEZES o telefone real via key.senderPn /
 * key.remoteJidAlt, mas em muitos cenarios (DM novo, grupo com privacidade,
 * chamadas) so o LID chega — e enviar resposta para "<lid>@s.whatsapp.net"
 * falha silenciosamente. Por isso mantemos um mapping local LID<->PN.
 *
 * APIs publicas:
 *   - captureLidPnMappingFromMessage(msg, whatsappId)
 *   - getPnForLid(lid, whatsappId)
 *   - getLidForPn(pn, whatsappId)
 *   - extractLidAndPnFromMessage(msg)  -> { lid?, pn? }
 *   - buildJidForSending({ lid?, pn?, isGroup }, preferLid?)
 */

import { proto } from "baileys";
import LidMapping from "../models/LidMapping";
import { logger } from "../utils/logger";

const onlyDigits = (s: string | undefined | null): string =>
  (s || "").replace(/\D/g, "");

const stripSuffix = (jid: string | undefined | null): string => {
  if (!jid) return "";
  const at = jid.indexOf("@");
  return at >= 0 ? jid.slice(0, at) : jid;
};

const isLidJid = (jid: string | undefined | null): boolean =>
  !!jid && jid.endsWith("@lid");

const isPnJid = (jid: string | undefined | null): boolean =>
  !!jid && jid.endsWith("@s.whatsapp.net");

/**
 * Tenta extrair o par (lid, pn) de uma mensagem. Olha em todos os campos
 * conhecidos: key.remoteJid, key.senderPn, key.remoteJidAlt, key.participant
 * e key.participantAlt (este ultimo so existe na 6.8+, mas o acesso e
 * defensivo).
 */
export const extractLidAndPnFromMessage = (
  msg: proto.IWebMessageInfo
): { lid?: string; pn?: string } => {
  const k = (msg.key as any) || {};
  const candidates: string[] = [
    k.remoteJid,
    k.senderPn,
    k.remoteJidAlt,
    k.participant,
    k.participantAlt,
    k.participantPn,
    k.senderLid
  ].filter(Boolean);

  let lid: string | undefined;
  let pn: string | undefined;
  for (const j of candidates) {
    if (!lid && isLidJid(j)) lid = stripSuffix(j);
    if (!pn && isPnJid(j)) pn = stripSuffix(j);
  }
  return { lid, pn };
};

/**
 * Persiste o par (lid, pn) para a sessao informada. Idempotente: se ja
 * existir, atualiza o pn (caso o WhatsApp tenha emitido um novo numero
 * vinculado ao mesmo LID — raro mas possivel quando o usuario muda telefone).
 */
export const saveLidPnMapping = async (
  lid: string,
  pn: string,
  whatsappId: number
): Promise<void> => {
  if (!lid || !pn || !whatsappId) return;
  if (lid === pn) return; // sanidade — nao mapear pra si mesmo

  try {
    const existing = await LidMapping.findOne({
      where: { lid, whatsappId }
    });

    if (existing) {
      if (existing.pn !== pn) {
        await existing.update({ pn });
      }
      return;
    }

    await LidMapping.create({ lid, pn, whatsappId });
  } catch (err) {
    // Concorrencia: dois eventos paralelos podem tentar criar — tolera
    // conflict de unique key.
    logger.warn(`saveLidPnMapping: falha ao persistir (${lid} -> ${pn}): ${err}`);
  }
};

/**
 * Conveniencia: extrai e ja persiste o mapping a partir de uma mensagem.
 * Chamado em todo messages.upsert.
 */
export const captureLidPnMappingFromMessage = async (
  msg: proto.IWebMessageInfo,
  whatsappId: number
): Promise<void> => {
  const { lid, pn } = extractLidAndPnFromMessage(msg);
  if (lid && pn) {
    await saveLidPnMapping(lid, pn, whatsappId);
  }
};

/**
 * Busca o phone number associado a um LID. Retorna undefined se nao houver
 * mapping conhecido.
 */
export const getPnForLid = async (
  lid: string,
  whatsappId: number
): Promise<string | undefined> => {
  if (!lid || !whatsappId) return undefined;
  const clean = onlyDigits(lid);
  if (!clean) return undefined;

  const row = await LidMapping.findOne({
    where: { lid: clean, whatsappId }
  });
  return row?.pn;
};

/**
 * Busca o LID associado a um phone number.
 */
export const getLidForPn = async (
  pn: string,
  whatsappId: number
): Promise<string | undefined> => {
  if (!pn || !whatsappId) return undefined;
  const clean = onlyDigits(pn);
  if (!clean) return undefined;

  const row = await LidMapping.findOne({
    where: { pn: clean, whatsappId }
  });
  return row?.lid;
};

/**
 * Decide o melhor JID para enviar uma mensagem.
 *
 * Estrategia:
 *   - Grupos sempre usam <id>@g.us.
 *   - Se temos LID conhecido, ele tem prioridade (mais confiavel quando a
 *     conversa comecou em LID — manda resposta no mesmo "trilho").
 *   - Caso contrario, usa o phone number em <number>@s.whatsapp.net.
 *
 * Para forcar o uso de PN (raro), passe preferLid=false.
 */
export const buildJidForSending = (params: {
  lid?: string | null;
  pn?: string | null;
  isGroup: boolean;
  preferLid?: boolean;
}): string => {
  const { lid, pn, isGroup, preferLid = true } = params;

  const cleanLid = onlyDigits(lid || "");
  const cleanPn = onlyDigits(pn || "");

  if (isGroup) {
    // Grupos: usa o pn (que e o id do grupo, sem @) — historicamente
    // o sistema guarda o group jid como Contact.number sem o sufixo.
    return `${cleanPn || cleanLid}@g.us`;
  }

  if (preferLid && cleanLid) {
    return `${cleanLid}@lid`;
  }
  if (cleanPn) {
    return `${cleanPn}@s.whatsapp.net`;
  }
  // Ultimo recurso: cai no LID se for o unico que temos.
  if (cleanLid) {
    return `${cleanLid}@lid`;
  }
  return "";
};
