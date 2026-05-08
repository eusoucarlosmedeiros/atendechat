# Data Engineer Notes — Baileys → uazapi (ADR-001)

**Autor:** Dara (data-engineer)
**Data:** 2026-05-09
**Status:** ✅ Schema validado, migrations criadas, models atualizados

Este documento responde às 3 questões em aberto deixadas pela Aria no
handoff e registra todas as decisões + arquivos entregues.

---

## 1. Decisões finais

### 1.1 Retenção de `WebhookEvents` → **30 dias**

**Justificativa:**
- 30 dias dão folga para auditoria e debug de incidentes pós-mortem.
- O payload é JSONB (compacto) e a tabela tem índice em `processedAt` →
  cleanup é uma query barata.
- Volume estimado: ~10k eventos/dia × 30 = 300k linhas/instância → trivial
  para Postgres com índice composto.

**Implementação do cleanup (responsabilidade do Dev/Dex):**

Sugestão de cron diário (à 03:00) usando `node-cron` (já dependência do projeto):

```ts
// dentro de queues.ts ou novo arquivo cleanup-jobs.ts
cron.schedule("0 3 * * *", async () => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const deleted = await WebhookEvent.destroy({
    where: { processedAt: { [Op.lt]: cutoff } }
  });
  logger.info(`WebhookEvents cleanup: ${deleted} linhas removidas (>30d)`);
});
```

⚠️ **Não criei esse job aqui** — fora do meu escopo. Sinalizo pra River
incluir como story.

### 1.2 `LidMappings` → **manter no PR atual; DROP em PR separado pós-cutover**

**Justificativa:**
- Cutover é único (decisão #2 do ADR), mas isso vale pro código de
  envio/webhook. Schema pode evoluir gradualmente sem impactar o cutover.
- Dropar agora aumenta superfície de regressão sem benefício.
- Renomear para `ContactIdentifiers` adicionaria 1 migration + refactor
  de imports — custo > benefício enquanto não é usada.
- A tabela vira "histórica": dados antigos preservados, sem novos inserts.

**Follow-up pós-cutover (registrar como story na River):**
- Migration `drop-lid-mappings.ts` após 1-2 sprints estáveis.
- Antes de dropar, exportar para CSV (audit trail).

### 1.3 `Messages.senderJid` + `senderLid` → **adicionar ambos, indexar só `senderJid`**

**Justificativa:**
- `dataJson` é STRING (não JSONB) no schema atual — query nele exige parse
  em runtime. Coluna explícita é ordens de magnitude mais rápida.
- `senderJid` é o filtro mais comum (auditoria de operador, listagens).
- `senderLid` é raro em filtro mas barato (STRING(80) nullable).
- Não criei index em `senderLid` para evitar overhead de write em uma
  coluna pouco consultada.

---

## 2. Entregas (arquivos novos/modificados)

### Migrations
| Arquivo | Operação |
|---------|----------|
| `backend/src/database/migrations/20260509100000-add-uazapi-fields-to-whatsapps.ts` | + 4 colunas + 2 índices únicos |
| `backend/src/database/migrations/20260509100100-create-webhook-events.ts` | CREATE TABLE + 2 índices |
| `backend/src/database/migrations/20260509100200-add-sender-jid-lid-to-messages.ts` | + 2 colunas + 1 índice |

### Models
| Arquivo | Operação |
|---------|----------|
| `backend/src/models/Whatsapp.ts` | + `uazapiInstanceId`, `uazapiToken`, `uazapiBaseUrl`, `uazapiWebhookSecret` |
| `backend/src/models/Message.ts` | + `senderJid`, `senderLid` |
| `backend/src/models/WebhookEvent.ts` | NOVO |
| `backend/src/database/index.ts` | + import e registro de `WebhookEvent` |

---

## 3. Schema final aprovado

### `Whatsapps` (delta)
```
+ uazapiInstanceId      VARCHAR(64)  NULL  UNIQUE  (idx)
+ uazapiToken           VARCHAR(255) NULL
+ uazapiBaseUrl         VARCHAR(255) NULL
+ uazapiWebhookSecret   VARCHAR(64)  NULL  UNIQUE  (idx)

# Mantidos por enquanto (deprecar pós-cutover, em PR separado):
  session     TEXT NULL    -- não popular mais
  battery     VARCHAR NULL -- não popular mais
  plugged     BOOL NULL    -- não popular mais
```

### `WebhookEvents` (nova tabela)
```sql
CREATE TABLE "WebhookEvents" (
  id              SERIAL PRIMARY KEY,
  "uazapiEventId" VARCHAR(100) NOT NULL,
  "eventType"     VARCHAR(50)  NOT NULL,
  "whatsappId"    INTEGER NOT NULL REFERENCES "Whatsapps"(id) ON DELETE CASCADE,
  "payload"       JSONB NOT NULL,
  "processedAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uniq_webhook_event_id_wid ON "WebhookEvents"("uazapiEventId", "whatsappId");
CREATE INDEX idx_webhook_events_wid_processed ON "WebhookEvents"("whatsappId", "processedAt");
```

### `Messages` (delta)
```
+ senderJid    VARCHAR(80) NULL  (idx)
+ senderLid    VARCHAR(80) NULL
```

---

## 4. Padrão de uso — orientação para Dev (Dex)

### 4.1 Criar instância uazapi (StartWhatsAppSession reescrito)

```ts
// pseudocódigo — implementação será da Fase 4 (story do River)
const initRes = await axios.post(`${UAZAPI_BASE_URL}/instance/init`, {}, {
  headers: { admintoken: process.env.UAZAPI_ADMIN_TOKEN }
});
const secret = crypto.randomBytes(32).toString("hex");
await whatsapp.update({
  uazapiInstanceId: initRes.data.id,
  uazapiToken: initRes.data.token,
  uazapiBaseUrl: UAZAPI_BASE_URL,
  uazapiWebhookSecret: secret
});
// configurar webhook
await axios.post(`${UAZAPI_BASE_URL}/webhook`, {
  url: `${UAZAPI_WEBHOOK_BASE_URL}/uazapi/webhook/${secret}`,
  events: ["messages","messages_update","connection","call","contacts","presence"],
  excludeMessages: ["wasSentByApi"],   // critical: evita loops
  enabled: true
}, { headers: { token: initRes.data.token } });
```

### 4.2 Receber webhook (UazapiWebhookController)

```ts
// pseudocódigo
const { secret } = req.params;
const whatsapp = await Whatsapp.findOne({ where: { uazapiWebhookSecret: secret } });
if (!whatsapp) return res.status(401).send("invalid secret");

const { id: uazapiEventId, eventType, ...payload } = req.body;

// IDEMPOTÊNCIA — esta é a barreira contra processamento duplo
try {
  await WebhookEvent.create({
    uazapiEventId,
    eventType,
    whatsappId: whatsapp.id,
    payload: req.body
  });
} catch (err) {
  if (err.name === "SequelizeUniqueConstraintError") {
    return res.status(200).send("ok (duplicate)");
  }
  throw err;
}

// processa o evento (handlers específicos por tipo)
await router(eventType, payload, whatsapp);
return res.status(200).send("ok");
```

### 4.3 Persistir mensagem (handleMessages)

```ts
// pseudocódigo dentro de handleMessages
await Message.upsert({
  id: payload.id,
  ticketId: ticket.id,
  contactId: contact.id,
  body: payload.text,
  fromMe: payload.from_me,
  remoteJid: payload.from || payload.to,
  senderJid: payload.wa_senderJid,    // ← coluna nova, indexada
  senderLid: payload.sender_lid,      // ← coluna nova, sem index
  participant: payload.participant,
  dataJson: JSON.stringify(payload),
  ack: mapStatus(payload.status),
  // ...
}, { companyId: whatsapp.companyId });
```

---

## 5. Riscos remanescentes (registrar pra River)

| Risco | Mitigação |
|-------|-----------|
| **Cleanup job esquecido** → tabela cresce indefinidamente | Story dedicada para criar o cron job |
| **Migration `drop-lid-mappings`** esquecida pós-cutover | Story de follow-up agendada para sprint+1 |
| **Volume de payload JSONB grande** (mensagens com mídia carregam URL inline) | Aceito; Postgres TOAST comprime automaticamente |
| **Race condition na criação de instância** (2 jobs criam ao mesmo tempo) | Lock pessimista no model (`SELECT ... FOR UPDATE`) — Dev decide |

---

## 6. Próximo handoff → @sm (River)

A camada de dados está validada e o build TypeScript passa limpo.
Próximo passo: River fatia o ADR-001 em stories executáveis usando este
documento + `HANDOFF-architect-to-data-engineer.md` + `ADR-001-baileys-to-uazapi.md`
como inputs.

**Stories sugeridas (River refina/aprova):**

1. **STORY-1.1** Cliente uazapi (libs/uazapi.ts) + wrappers `services/UazapiServices/*`
2. **STORY-1.2** Migrations + models (este PR — pode entrar antes mesmo das outras stories) ✅
3. **STORY-2.1** UazapiWebhookController + handlers (`UazapiWebhookServices/*`) + idempotência via `WebhookEvents`
4. **STORY-2.2** Cleanup job de `WebhookEvents` (cron 30d)
5. **STORY-3.1** Reescrever `SendWhatsAppMessage` + `SendWhatsAppMedia` + `DeleteWhatsAppMessage` para uazapi
6. **STORY-4.1** `StartWhatsAppSession` + `WhatsAppSessionController` (QR via uazapi)
7. **STORY-4.2** `WhatsAppController` lendo status da uazapi
8. **STORY-5.1** `queues.ts` campanhas trocando cliente para uazapi (mantendo Bull)
9. **STORY-5.2** `typebotListener`, `helpers/SendMessage`, `CheckNumber`, `GetProfilePicUrl`, `ImportContactsService`
10. **STORY-5.3** `wbotMonitor` (calls) → `handleCall` no webhook
11. **STORY-6.1** Cutover: remover `baileys` deps do package.json, deletar arquivos legacy
12. **STORY-6.2** (sprint+1) Drop `Baileys`, `BaileysChats`, `LidMappings` tables

---

## 7. Validação

- ✅ TypeScript build limpo (`npx tsc --noEmit` sem erros)
- ⏳ Migrations não rodadas (será aplicado no deploy via `update.sh` da VPS)
- ⏳ Tabela `WebhookEvents` não criada em prod (idem)

— Dara, modelando dados com paixão 🗄️
