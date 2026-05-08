/**
 * scripts/backfillLidMappings.ts
 *
 * Script utilitario, executado UMA vez apos o deploy do fix LID/PN.
 *
 * Para todo Contact cuja `number` parece ser um LID (heuristica: 13+ digitos
 * sem prefixo de pais plausivel), tenta resolver o telefone real via:
 *   1. LidMappings — populado naturalmente por novas mensagens recebidas
 *      depois do deploy.
 *   2. Mensagens persistidas em Message.dataJson — varre os ultimos N
 *      registros do contato procurando key.senderPn / key.remoteJidAlt.
 *
 * Quando encontra o telefone, atualiza Contact.number = telefone real e
 * Contact.lid = LID original. Quando nao encontra, deixa marcado em
 * Contact.lid (para uso pelo SendWhatsApp* — manda no @lid).
 *
 * Uso (dentro de /home/deploy/atendechat/backend):
 *   npx ts-node src/scripts/backfillLidMappings.ts
 *   # ou apos build:
 *   node dist/scripts/backfillLidMappings.js
 */

import "../bootstrap";
import database from "../database";
import Contact from "../models/Contact";
import Message from "../models/Message";
import LidMapping from "../models/LidMapping";
import { Op } from "sequelize";

// Heuristica conservadora: LIDs costumam ter 14+ digitos. Telefones
// internacionais validos tem entre 8 e 15 digitos, mas em geral 10-13.
// Marcamos como "suspeito de ser LID" se tem 14+ digitos OU se nao bate
// com nenhum prefixo de pais conhecido. Para minimizar falsos positivos,
// usamos so o criterio "14+ digitos" — telefones validos sao raros
// nessa faixa em produtos brasileiros.
const looksLikeLid = (number: string): boolean => {
  if (!number) return false;
  const digits = number.replace(/\D/g, "");
  return /^\d{14,}$/.test(digits);
};

const tryResolveFromMappings = async (
  lid: string,
  whatsappId: number | null
): Promise<string | undefined> => {
  const where: any = { lid };
  if (whatsappId) where.whatsappId = whatsappId;
  const row = await LidMapping.findOne({ where });
  return row?.pn;
};

const tryResolveFromMessages = async (
  contactId: number
): Promise<string | undefined> => {
  // Pega as ultimas 50 mensagens do ticket do contato e procura
  // dataJson com key.senderPn ou key.remoteJidAlt.
  const messages = await Message.findAll({
    where: {
      ticketId: { [Op.ne]: null },
      contactId
    } as any,
    order: [["createdAt", "DESC"]],
    limit: 50
  });

  for (const m of messages) {
    if (!m.dataJson) continue;
    try {
      const parsed = JSON.parse(m.dataJson);
      const k = parsed?.key || {};
      const candidates: string[] = [k.senderPn, k.remoteJidAlt, k.participantAlt]
        .filter((j: string | undefined) => typeof j === "string" && j.endsWith("@s.whatsapp.net"));
      if (candidates[0]) {
        return candidates[0].split("@")[0];
      }
    } catch (_) {
      /* ignore parse errors */
    }
  }
  return undefined;
};

const main = async () => {
  await database.authenticate();
  console.log("==> Backfill LID->PN mappings iniciado");

  const suspects = await Contact.findAll({
    where: {
      isGroup: false,
      // contatos com lid ja preenchido OU number suspeito de ser LID
      [Op.or]: [
        { lid: { [Op.not]: null } as any },
        // sequelize-typescript nao tem regex no findAll do postgres direto;
        // pegamos todos e filtramos em JS.
      ]
    } as any
  });

  // segunda passada: pega os "number suspeito" tambem.
  const allContacts = await Contact.findAll({ where: { isGroup: false } });
  const candidates = new Map<number, Contact>();
  for (const c of [...suspects, ...allContacts]) {
    if (looksLikeLid(c.number) || c.lid) {
      candidates.set(c.id, c);
    }
  }

  console.log(`Encontrados ${candidates.size} contatos candidatos a backfill.`);

  let updated = 0;
  let kept = 0;
  let lidStored = 0;

  for (const c of candidates.values()) {
    // Determina qual e o LID atual: ou ja esta em c.lid, ou esta em c.number.
    const currentLid = c.lid || (looksLikeLid(c.number) ? c.number : undefined);
    if (!currentLid) {
      kept++;
      continue;
    }

    let pn = await tryResolveFromMappings(currentLid, c.whatsappId);
    if (!pn) {
      pn = await tryResolveFromMessages(c.id);
    }

    if (pn) {
      // achou telefone real: arruma o contato.
      const updates: Partial<Contact> = { lid: currentLid };
      if (looksLikeLid(c.number) || c.number !== pn) {
        updates.number = pn;
      }
      await c.update(updates);
      console.log(`  [OK] Contact#${c.id}: number=${c.number} -> ${pn} (lid=${currentLid})`);
      updated++;
    } else {
      // sem mapping conhecido: garante ao menos que c.lid esteja preenchido.
      if (!c.lid && currentLid) {
        await c.update({ lid: currentLid });
        lidStored++;
      }
      kept++;
    }
  }

  console.log("==> Backfill concluido");
  console.log(`    Atualizados (number corrigido): ${updated}`);
  console.log(`    LID preenchido sem PN: ${lidStored}`);
  console.log(`    Mantidos sem alteracao: ${kept}`);

  await database.close();
  process.exit(0);
};

main().catch(err => {
  console.error("Falha no backfill:", err);
  process.exit(1);
});
