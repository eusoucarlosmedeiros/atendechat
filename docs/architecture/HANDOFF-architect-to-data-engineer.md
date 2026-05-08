# Handoff: Architect (Aria) → Data Engineer (Dara)

**Data:** 2026-05-08
**Contexto:** Migração Baileys → uazapi (ver ADR-001)

---

## Sua missão

Validar e detalhar o **modelo de dados** do ADR-001, criando as migrations Sequelize correspondentes. **Cutover único** (sem feature flag).

---

## 1. Mudanças na tabela `Whatsapps`

**Arquivo:** `backend/src/models/Whatsapp.ts`

### Adicionar:
- `uazapiInstanceId VARCHAR(64) NULL` — UUID retornado por `POST /instance/init`. Único por instância. Index único.
- `uazapiToken VARCHAR(255) NULL` — token de auth da instância (header `token: ...`).
- `uazapiBaseUrl VARCHAR(255) NULL` — URL base. Quando NULL, usa `process.env.UAZAPI_BASE_URL`.
- `uazapiWebhookSecret VARCHAR(64) NULL` — segredo gerado por nós para validar requests do webhook (compõe URL: `https://api.x.com/uazapi/webhook/{secret}`).

### Deprecar (não dropar agora — manter pra rollback):
- `session TEXT` — não usado mais. Marcar como `nullable=true` (já é).
- `battery VARCHAR` — uazapi não fornece.
- `plugged BOOLEAN` — uazapi não fornece.

### Mantém (semântica preservada):
- `qrcode TEXT` — uazapi também devolve QR (base64 de imagem).
- `status VARCHAR` — mapear estados uazapi para os já existentes:
  - `disconnected` (uazapi) → `DISCONNECTED` (sistema)
  - `connecting` → `OPENING`
  - `connected` → `CONNECTED`
  - `qrcode` (esperando scan) → `qrcode`

### Migration sugerida:
```ts
// backend/src/database/migrations/YYYYMMDDHHMMSS-add-uazapi-fields-to-whatsapps.ts
up: async (qi: QueryInterface) => {
  await qi.addColumn("Whatsapps", "uazapiInstanceId", { type: DataTypes.STRING(64), allowNull: true });
  await qi.addColumn("Whatsapps", "uazapiToken",      { type: DataTypes.STRING(255), allowNull: true });
  await qi.addColumn("Whatsapps", "uazapiBaseUrl",    { type: DataTypes.STRING(255), allowNull: true });
  await qi.addColumn("Whatsapps", "uazapiWebhookSecret", { type: DataTypes.STRING(64), allowNull: true });
  await qi.addIndex("Whatsapps", ["uazapiInstanceId"], { unique: true, name: "uniq_whatsapps_uazapi_instance" });
}
```

---

## 2. Tabela nova: `WebhookEvents` (idempotência)

**Por que:** uazapi pode entregar o mesmo evento mais de uma vez (sem garantia at-least-once nem at-most-once documentada). Precisamos deduplicar pelo `id` que vem no payload.

```sql
CREATE TABLE "WebhookEvents" (
  id SERIAL PRIMARY KEY,
  "uazapiEventId" VARCHAR(100) NOT NULL,
  "eventType"     VARCHAR(50)  NOT NULL,    -- messages, messages_update, connection, call, contacts, presence
  "whatsappId"    INTEGER NOT NULL REFERENCES "Whatsapps"(id) ON DELETE CASCADE,
  "payload"       JSONB NOT NULL,
  "processedAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_webhook_event UNIQUE ("uazapiEventId", "whatsappId")
);
CREATE INDEX idx_webhook_events_wid_processed ON "WebhookEvents"("whatsappId", "processedAt");
```

**Considerações:**
- `payload JSONB` armazena o evento bruto (útil pra debug).
- `processedAt` permite job de retenção (deletar após N dias).
- `eventType` index não é necessário — queries vão por `whatsappId + processedAt`.

**Pergunta para você:** **retenção** desses eventos — 30 dias? 7 dias? Ou indefinido?

---

## 3. Tabelas a deprecar

### 3.1 `Baileys` e `BaileysChats`

Caches da Baileys que não fazem mais sentido com uazapi.

**Recomendação:**
- **Não dropar agora** (no PR de cutover). Apenas parar de escrever (já será efeito automático após remoção dos services).
- Migration de `DROP TABLE` em PR separado, **após 1-2 semanas em produção** com uazapi estável.

### 3.2 `LidMappings`

Pode permanecer:
- Útil pra compor histórico de identificadores de contato.
- Não populamos mais ativamente (uazapi resolve sozinha LID/PN).
- Considerar migration que renomeie pra `ContactIdentifiers` ou similar — mais expressivo.

**Decisão tua, Dara:** mantém, renomeia ou dropa?

---

## 4. Tabela `Contacts` — `lid` continua

`Contacts.lid` continua útil pra rastreabilidade (algumas integrações externas podem precisar).

Não é mais usado como chave de envio (uazapi resolve pelo `number`). Mantém como está.

---

## 5. Tabela `Messages` — possível adição

A uazapi retorna campos relevantes nos eventos: `wa_senderJid`, `sender_lid`, `messageType` mais granular. Avaliar:

- Precisamos persistir `senderLid`/`senderJid` separado em `Messages`?
- O `dataJson` atual já guarda o payload completo — talvez seja suficiente.

**Decisão tua:** adicionar colunas explícitas (queries mais rápidas) ou seguir extraindo do `dataJson`?

---

## 6. Configuração / env vars

A camada de cliente precisa:
```bash
UAZAPI_BASE_URL=https://api.uazapi.com         # default quando Whatsapps.uazapiBaseUrl é NULL
UAZAPI_ADMIN_TOKEN=...                          # token admin pra criar/listar instâncias
UAZAPI_WEBHOOK_BASE_URL=https://api.atendechat.com  # URL pública que recebe webhook
```

**Não é responsabilidade tua mexer em `.env`** — só estou registrando pra contexto.

---

## 7. O que eu preciso de você

1. **Validar** o desenho dos campos (tipos, nullability, índices).
2. **Criar as migrations** definitivas em `backend/src/database/migrations/` (com timestamps corretos):
   - `YYYYMMDDHHMMSS-add-uazapi-fields-to-whatsapps.ts`
   - `YYYYMMDDHHMMSS-create-webhook-events.ts`
3. **Atualizar models** correspondentes (`Whatsapp.ts`, novo `WebhookEvent.ts`).
4. **Decidir** as 3 perguntas em aberto:
   - Retenção de `WebhookEvents` (sugestão: 30 dias, com job de cleanup).
   - `LidMappings`: manter, renomear ou dropar?
   - `Messages`: colunas explícitas pra `senderLid` / `senderJid`?
5. **Documentar** sua escolha em `docs/architecture/DATA-ENGINEER-NOTES.md` ou append no ADR-001.

---

## 8. O que NÃO é responsabilidade tua

- Lógica de aplicação (Aria + Dex).
- Endpoints REST / webhook controller (Aria + Dex).
- Decisões de negócio (Carlos via Pax/Morgan).

---

## 9. Próximo handoff

Quando você terminar:
- Atualiza este doc com tuas notas.
- Sinaliza ao Architect (Aria) → handoff para SM (River) começar a fatiar stories.

— Aria, arquitetando o futuro 🏗️
