/**
 * LidPnResolver
 *
 * Helpers para lidar com a coexistencia de JIDs @lid (Locally Identifiable
 * Device) e @s.whatsapp.net (Phone Number) introduzida pelo WhatsApp em
 * 2024+. Mantemos um mapping LID<->PN para conseguir enviar respostas no
 * formato @s.whatsapp.net (que e o unico que o WhatsApp entrega de fato —
 * envios para @lid resultam em "Aguardando esta mensagem" no destinatario).
 *
 * APIs publicas:
 *   - captureLidPnMappingFromMessage(msg, whatsappId)
 *   - getPnForLid(lid, whatsappId)
 *   - getLidForPn(pn, whatsappId)
 *   - extractLidAndPnFromMessage(msg)  -> { lid?, pn? }
 *   - buildJidForSending({ lid?, pn?, isGroup })  // sempre prefere PN
 *   - resolveBestJidForTicket(ticket, wbot)  // logica completa de resolucao
 */

import { proto, WASocket } from "baileys";
import LidMapping from "../models/LidMapping";
import Message from "../models/Message";
import Ticket from "../models/Ticket";
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
  // Inclui campos de envios fromMe (recipientPn/recipientLid) — quando o
  // WhatsApp ecoa nossa mensagem enviada, esses campos podem trazer o
  // mapping completo do destinatario.
  const candidates: string[] = [
    k.remoteJid,
    k.senderPn,
    k.remoteJidAlt,
    k.participant,
    k.participantAlt,
    k.participantPn,
    k.senderLid,
    k.recipientPn,
    k.recipientLid
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
 * REGRA: sempre prefere PN (@s.whatsapp.net), porque enviar para @lid
 * NAO entrega — o destinatario fica vendo "Aguardando esta mensagem".
 * O LID so e usado como ultimo recurso (provavelmente vai falhar, mas
 * ao menos algo aparece nos logs).
 *
 *   - Grupos: <id>@g.us
 *   - Se temos PN: <pn>@s.whatsapp.net (caminho feliz)
 *   - Se so temos LID: <lid>@lid (gambiarra, vai falhar — log!)
 *
 * Para forcar @lid (debug), passe forceLid=true.
 */
export const buildJidForSending = (params: {
  lid?: string | null;
  pn?: string | null;
  isGroup: boolean;
  forceLid?: boolean;
}): string => {
  const { lid, pn, isGroup, forceLid = false } = params;

  const cleanLid = onlyDigits(lid || "");
  const cleanPn = onlyDigits(pn || "");

  if (isGroup) {
    return `${cleanPn || cleanLid}@g.us`;
  }

  if (forceLid && cleanLid) {
    return `${cleanLid}@lid`;
  }

  // PN sempre primeiro — e o que o WhatsApp entrega.
  if (cleanPn) {
    return `${cleanPn}@s.whatsapp.net`;
  }

  // Ultimo recurso: tenta @lid (provavelmente vai falhar).
  if (cleanLid) {
    return `${cleanLid}@lid`;
  }

  return "";
};

/**
 * Heuristica: o "number" do contato parece ser um LID em vez de telefone real?
 * - Numero igual ao LID (mesmo string) = certeza
 * - 14+ digitos = muito provavel
 * - Numero brasileiro tem 11-13 digitos com codigo pais (55), entao 14+
 *   raramente e telefone valido.
 */
export const numberLooksLikeLid = (
  number: string | undefined,
  lid?: string | undefined
): boolean => {
  if (!number) return false;
  const n = onlyDigits(number);
  if (lid && n === onlyDigits(lid)) return true;
  return /^\d{14,}$/.test(n);
};

/**
 * Tenta descobrir o PN real para um LID que nao temos no LidMapping.
 * Estrategias tentadas em ordem:
 *   1. wbot.onWhatsApp(lid) — pode resolver via USync
 *   2. Parse de Message.dataJson das ultimas N mensagens do ticket procurando
 *      qualquer campo (senderPn, recipientPn, remoteJidAlt) com @s.whatsapp.net
 *
 * Retorna o PN (so a parte numerica) ou undefined.
 */
const discoverPnForLid = async (
  lid: string,
  ticket: Ticket,
  wbot: WASocket
): Promise<string | undefined> => {
  // 1) onWhatsApp — funciona em alguns casos
  try {
    const lidJid = `${lid}@lid`;
    const result = await wbot.onWhatsApp(lidJid);
    if (Array.isArray(result) && result.length > 0) {
      const r: any = result[0];
      // Algumas versoes retornam { jid, exists } — se jid for diferente do
      // input e for @s.whatsapp.net, encontramos o PN.
      const candidate: string = r?.jid || r?.id || "";
      if (typeof candidate === "string" && candidate.endsWith("@s.whatsapp.net")) {
        return stripSuffix(candidate);
      }
    }
  } catch (err) {
    logger.warn(`onWhatsApp(${lid}@lid) falhou: ${err}`);
  }

  // 2) Parse das ultimas mensagens do ticket
  try {
    const messages = await Message.findAll({
      where: { ticketId: ticket.id },
      order: [["createdAt", "DESC"]],
      limit: 30
    });
    for (const m of messages) {
      if (!m.dataJson) continue;
      try {
        const parsed = JSON.parse(m.dataJson);
        const k = parsed?.key || {};
        const candidates: string[] = [
          k.senderPn,
          k.recipientPn,
          k.remoteJidAlt,
          k.participantAlt,
          k.participantPn
        ].filter((j: string | undefined) => typeof j === "string" && j.endsWith("@s.whatsapp.net"));
        if (candidates[0]) {
          return stripSuffix(candidates[0]);
        }
      } catch (_) { /* ignore parse error */ }
    }
  } catch (err) {
    logger.warn(`busca de PN no historico do ticket ${ticket.id} falhou: ${err}`);
  }

  return undefined;
};

/**
 * Resolve o melhor JID para enviar uma mensagem deste ticket. Esta e a
 * funcao a ser usada pelos services SendWhatsApp* — combina os mappings
 * persistidos, o cache LidMappings e tentativas de descoberta em runtime
 * (onWhatsApp + historico de mensagens).
 *
 * Efeito colateral: quando descobre um PN para um contato que estava
 * "preso em LID" (Contact.number === Contact.lid), atualiza o registro
 * para corrigir o number — assim os proximos envios ja vao direto.
 */
export const resolveBestJidForTicket = async (
  ticket: Ticket,
  wbot: WASocket & { id?: number }
): Promise<string> => {
  const contact: any = ticket.contact;
  if (!contact) return "";

  if (ticket.isGroup) {
    return `${onlyDigits(contact.number)}@g.us`;
  }

  const whatsappId = (ticket.whatsappId || wbot.id) as number;

  // 1) Caminho feliz: ja temos PN real (number != lid e number e numerico
  //    plausivel).
  const numberLooksLid = numberLooksLikeLid(contact.number, contact.lid);
  if (!numberLooksLid && contact.number) {
    return `${onlyDigits(contact.number)}@s.whatsapp.net`;
  }

  // 2) Contact.number e LID — temos que resolver. Usa Contact.lid se setado,
  //    senao reusa o proprio number (que e o LID).
  const lid = onlyDigits(contact.lid || contact.number);
  if (!lid) return "";

  // 2.1) LidMapping no banco
  let pn = await getPnForLid(lid, whatsappId);

  // 2.2) Descoberta runtime (onWhatsApp + parse historico)
  if (!pn) {
    pn = await discoverPnForLid(lid, ticket, wbot);
    if (pn) {
      // Persiste o mapping descoberto para acelerar proximos envios
      await saveLidPnMapping(lid, pn, whatsappId);
    }
  }

  if (pn) {
    // Atualiza o contato: corrige number e preserva lid.
    try {
      const updates: any = { lid };
      if (contact.number !== pn) updates.number = pn;
      await contact.update(updates);
      logger.info(`LID resolvido: contact#${contact.id} lid=${lid} -> pn=${pn}`);
    } catch (err) {
      logger.warn(`falha ao atualizar contact#${contact.id}: ${err}`);
    }
    return `${pn}@s.whatsapp.net`;
  }

  // 3) Sem PN conhecido — registra log e tenta @lid mesmo (vai falhar
  //    provavelmente, mas e o que temos).
  logger.warn(
    `[LID-NORESOLVE] ticket=${ticket.id} contact=${contact.id} lid=${lid} ` +
    `nao foi possivel descobrir PN; tentando enviar para @lid (provavel falha).`
  );
  return `${lid}@lid`;
};
