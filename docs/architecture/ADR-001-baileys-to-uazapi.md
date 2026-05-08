# ADR-001: Migração Baileys → uazapi

- **Status:** Aceito (decisões #1-4 confirmadas pelo Carlos em 2026-05-08)
- **Data:** 2026-05-08
- **Autor:** Aria (architect)
- **Próximos:** Dara (data-engineer) → River (sm)
- **Decisão de:** Carlos Medeiros

---

## 1. Contexto

O backend do Atendechat usa a biblioteca **Baileys** (`baileys@6.7.18` via `@whiskeysockets/baileys` originalmente) como cliente WhatsApp Web. Os últimos meses revelaram problemas crônicos:

1. **Bug de envio (`getMessage` retry):** WhatsApp pede reenvio de mensagens; sem buffer de mensagens enviadas, o envio falha silenciosamente.
2. **Drama do LID** (`@lid` vs `@s.whatsapp.net`): contatos novos chegam com identificador opaco, e o sistema salva o LID como `Contact.number`, quebrando o envio.
3. **Versão deprecada** (`@whiskeysockets/baileys` foi descontinuada; sucessor `baileys` v6.7.19+ é ESM puro, incompatível com nosso `tsconfig.module=commonjs`).
4. **API instável**: a v7.0.0 está em RC há 8+ meses, com dependência nativa em Rust (`whatsapp-rust-bridge`).
5. **Manutenção alta**: cada upgrade do WhatsApp protocol exige fix no código.

**Decisão tomada:** substituir 100% da Baileys pelo **uazapi** — uma API HTTP gerenciada que abstrai o WhatsApp Web e expõe endpoints REST + webhook.

---

## 2. Visão geral comparativa

| Aspecto | Baileys (atual) | uazapi (proposto) |
|---------|----------------|-------------------|
| Modelo | SDK in-process (WebSocket cliente) | API HTTP externa + webhook |
| Estado de sessão | Blob `creds + keys` no DB | Token gerenciado pela uazapi |
| LID/PN handling | Manual (nossa tabela `LidMappings`) | Nativo (`sender_lid` + `jid` no payload) |
| Recebimento | `wbot.ev.on("messages.upsert")` | `POST /webhook` no nosso backend |
| Envio | `wbot.sendMessage(jid, content)` | `POST /send/text` (e variantes) |
| QR / login | `connection.update` event | `POST /instance/connect` retorna QR |
| Multi-instância | Map em memória (`sessions[]`) | Lista de instâncias na uazapi |
| Latência | Baixa (in-process) | Média (HTTP roundtrip ~50-200ms) |
| Resiliência | WebSocket pode cair | HTTP retry-friendly + webhook desacoplado |
| Custo | $0 (open source) | Pago (ou self-host) |

---

## 3. Inventário do que será refatorado

### 3.1 Arquivos com import direto de Baileys (15 arquivos — REMOVER imports)

```
backend/src/libs/wbot.ts                                       ← REMOVER
backend/src/libs/store.d.ts                                    ← REMOVER
backend/src/helpers/authState.ts                               ← REMOVER
backend/src/helpers/GetTicketWbot.ts                           ← SUBSTITUIR
backend/src/helpers/GetWbotMessage.ts                          ← REVISAR
backend/src/helpers/SetTicketMessagesAsRead.ts                 ← REESCREVER
backend/src/helpers/LidPnResolver.ts                           ← MANTER PARCIAL
backend/src/services/WbotServices/SendWhatsAppMessage.ts       ← REESCREVER
backend/src/services/WbotServices/SendWhatsAppMedia.ts         ← REESCREVER
backend/src/services/WbotServices/DeleteWhatsAppMessage.ts     ← REESCREVER
backend/src/services/WbotServices/wbotMessageListener.ts       ← VIRA WebhookHandler
backend/src/services/WbotServices/wbotMonitor.ts               ← VIRA WebhookHandler (calls)
backend/src/services/WbotServices/providers.ts                 ← REVISAR
backend/src/services/BaileysServices/CreateOrUpdateBaileysService.ts    ← DEPRECAR
backend/src/services/BaileysChatServices/CreateOrUpdateBaileysChatService.ts  ← DEPRECAR
backend/src/services/TypebotServices/typebotListener.ts        ← REESCREVER (envio via uazapi)
```

### 3.2 Arquivos que tocam `wbot` indiretamente (10 arquivos — adaptar chamadas)

```
backend/src/controllers/WhatsAppController.ts                  ← ajustar status fetch
backend/src/controllers/WhatsAppSessionController.ts           ← QR via /instance/connect
backend/src/helpers/GetWhatsappWbot.ts                         ← retorna client uazapi
backend/src/helpers/SendMessage.ts                             ← refatorar
backend/src/queues.ts                                          ← campanhas via /sender/* OU /send/*
backend/src/services/TicketServices/UpdateTicketService.ts     ← revisar refs
backend/src/services/WbotServices/CheckIsValidContact.ts       ← /chat/check
backend/src/services/WbotServices/CheckNumber.ts               ← /chat/check
backend/src/services/WbotServices/GetProfilePicUrl.ts          ← /chat/details
backend/src/services/WbotServices/ImportContactsService.ts     ← /contacts
backend/src/services/WbotServices/StartAllWhatsAppsSessions.ts ← itera Whatsapps no boot
backend/src/services/WbotServices/StartWhatsAppSession.ts      ← cria/conecta instância
```

### 3.3 Arquivos NOVOS

```
backend/src/libs/uazapi.ts                          ← cliente HTTP (axios) com pool
backend/src/controllers/UazapiWebhookController.ts  ← endpoint que recebe eventos
backend/src/services/UazapiWebhookServices/        ← handlers por tipo de evento
  ├── handleConnection.ts
  ├── handleMessages.ts
  ├── handleMessagesUpdate.ts
  ├── handleCall.ts
  ├── handleContacts.ts
  └── handlePresence.ts
backend/src/services/UazapiServices/               ← wrappers tipados dos endpoints
  ├── instance/
  │   ├── ConnectInstance.ts
  │   ├── DisconnectInstance.ts
  │   ├── GetInstanceStatus.ts
  │   └── InitInstance.ts
  ├── send/
  │   ├── SendText.ts
  │   ├── SendMedia.ts
  │   ├── SendLocation.ts
  │   ├── SendContact.ts
  │   ├── SendMenu.ts
  │   ├── SendReact.ts
  │   └── SendStatus.ts
  ├── chat/
  │   ├── CheckNumber.ts
  │   ├── ReadChat.ts
  │   ├── DeleteMessage.ts
  │   └── ChatDetails.ts
  └── group/
      └── ... (criar/listar/participantes)
```

---

## 4. Mapeamento Baileys ↔ uazapi (cheatsheet)

| Operação atual (Baileys) | Endpoint uazapi |
|--------------------------|-----------------|
| `makeWASocket(...)` | `POST /instance/init` + `POST /instance/connect` |
| `wbot.logout()` | `POST /instance/disconnect` |
| `wbot.ev.on("connection.update", ...)` | webhook event `connection` |
| `wbot.ev.on("messages.upsert", ...)` | webhook event `messages` |
| `wbot.ev.on("messages.update", ...)` | webhook event `messages_update` |
| `wbot.ws.on("CB:call", ...)` | webhook event `call` |
| `wbot.ev.on("contacts.upsert", ...)` | webhook event `contacts` |
| `wbot.sendMessage(jid, { text })` | `POST /send/text` (`{ number, text }`) |
| `wbot.sendMessage(jid, { image })` | `POST /send/media` (`{ number, type:"image", file }`) |
| `wbot.sendMessage(jid, { audio, ptt })` | `POST /send/media` (`{ type:"ptt" }`) |
| `wbot.sendMessage(jid, { delete: ... })` | `POST /message/delete` |
| `wbot.chatModify({ markRead })` | `POST /chat/read` |
| `wbot.presenceSubscribe / sendPresenceUpdate` | `POST /message/presence` |
| `wbot.profilePictureUrl(jid)` | `POST /chat/details` (campo `profilePicUrl`) |
| `wbot.onWhatsApp(num)` | `POST /chat/check` |
| `wbot.groupMetadata(jid)` | `POST /group/info` |
| `wbot.groupCreate / groupParticipantsUpdate` | `POST /group/create` / `/group/updateParticipants` |
| `downloadMediaMessage(msg)` | `POST /message/download` (vem na URL do payload) |
| `getMessage` callback (retry hell) | **DESAPARECE** — uazapi gerencia internamente |

---

## 5. Mudanças no fluxo de dados

### 5.1 Fluxo de mensagem recebida

**Antes (Baileys):**
```
WhatsApp → WebSocket → Baileys → wbot.ev.on("messages.upsert") → handleMessage
```

**Depois (uazapi):**
```
WhatsApp → uazapi → POST https://nosso-backend/uazapi/webhook
  → UazapiWebhookController valida token + idempotência (id já visto?)
  → roteador por event type
  → handleMessages → mesma lógica de negócio do handleMessage atual
```

### 5.2 Fluxo de envio

**Antes:**
```
operador clica enviar → SendWhatsAppMessage → wbot.sendMessage(jid, {text})
```

**Depois:**
```
operador clica enviar → SendWhatsAppMessage
  → axios.post(`${UAZAPI_URL}/send/text`,
       { number: ticket.contact.number, text },
       { headers: { token: whatsapp.uazapiToken } })
  → resposta vem com message id (salvar em Message para tracking)
```

### 5.3 Fluxo de QR / login

**Antes:**
```
POST /whatsappsession/{id} → StartWhatsAppSession → makeWASocket
  → connection.update {qr} → grava em Whatsapps.qrcode → frontend pega via socket.io
```

**Depois:**
```
POST /whatsappsession/{id} → StartWhatsAppSession
  → POST uazapi /instance/init (se não existe ainda) → guarda token
  → POST uazapi /instance/connect → retorna QR base64
  → grava em Whatsapps.qrcode → frontend pega via socket.io (igual)
  → polling em GET /instance/status até connected → atualiza Whatsapps.status
```

---

## 6. Riscos e mitigações

| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| **Webhook não chega** (rede/uazapi indisponível) | 🔴 Alta | Tabela `WebhookEvents` com idempotência; rota de re-sincronização manual; alertas |
| **Sem assinatura HMAC** | 🟡 Média | URL secreta + token de instância em header + IP whitelist |
| **Latência maior** | 🟡 Média | Pool de conexões axios (keep-alive); timeouts agressivos com retry |
| **Custo da uazapi** | 🟡 Média | Confirmar plano com Carlos; considerar self-host |
| **Migração de instâncias existentes** | 🟠 Alta | **Não há migração**: clientes precisam refazer QR. Comunicar antes. |
| **Limites do plano free/demo (TTL)** | 🟡 Média | Validar plano usado; comprar plano produção |
| **Duplicação de eventos** | 🟢 Baixa | Idempotência via `Message.id` + `WebhookEvents.eventId` |
| **Webhook precisa HTTPS público** | 🟢 Baixa | Já temos (Nginx + Certbot configurados) |
| **Rate limiting indefinido** | 🟡 Média | Backoff exponencial + queue local pra reenvio |
| **Fluxo de campanhas (queues.ts)** | 🟡 Média | Avaliar usar `/sender/*` da uazapi vs manter nossa fila + chamar `/send/text` |

---

## 7. Modelo de dados — mudanças (rascunho para Data Engineer validar)

### 7.1 Tabela `Whatsapps` — alterações

```diff
 @Column session: string;            -- DEPRECAR (não mais usado)
+@Column uazapiInstanceId: string;   -- UUID retornado por POST /instance/init
+@Column uazapiToken: string;        -- token da instância
+@Column uazapiBaseUrl: string;      -- ex: https://free.uazapi.com (opcional, default env)
+@Column uazapiWebhookSecret: string; -- segredo gerado para validar webhook
 @Column qrcode: string;             -- mantém (uazapi também devolve QR)
 @Column status: string;             -- mantém (mapear states uazapi)
-@Column battery: string;            -- DEPRECAR (uazapi não fornece)
-@Column plugged: boolean;           -- DEPRECAR
```

### 7.2 Tabelas a deprecar

- **`Baileys`** (cache de chats/contatos da Baileys) — não faz mais sentido; uazapi não tem store local.
- **`BaileysChats`** — mesma razão.
- **`LidMappings`** — pode permanecer (ainda útil pra normalizar números legados); não popular mais ativamente.

### 7.3 Tabelas novas

```sql
-- Idempotência de webhook events (impede processamento duplo)
CREATE TABLE "WebhookEvents" (
  id SERIAL PRIMARY KEY,
  "uazapiEventId" VARCHAR(100) NOT NULL UNIQUE,  -- id que vem no payload
  "eventType" VARCHAR(50) NOT NULL,
  "whatsappId" INTEGER REFERENCES "Whatsapps"(id) ON DELETE CASCADE,
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_webhook_events_wid ON "WebhookEvents"("whatsappId", "processedAt");
```

### 7.4 Tabela `Contacts` — manter `lid` mas semântica muda

`Contact.lid` continua útil pra exibir identificador secundário. Não usado mais como chave de envio (uazapi resolve sozinha pelo `number`).

---

## 8. Configuração / Variáveis de ambiente

```bash
# .env adicional
UAZAPI_BASE_URL=https://free.uazapi.com         # ou URL do plano pago/self-host
UAZAPI_ADMIN_TOKEN=xxxxx                        # token admin para criar instâncias
UAZAPI_WEBHOOK_BASE_URL=https://api.atendechat.example.com  # URL que aponta pro nosso backend
UAZAPI_WEBHOOK_PATH=/uazapi/webhook             # path único + secreto por instância
```

---

## 9. Plano de migração — em fases

### Fase 0 — Pré-requisitos (1 dia)
- Conta uazapi criada e validada.
- Plano definido (free vs paid).
- Domínio HTTPS público para receber webhook.
- Approval do data-engineer no schema.

### Fase 1 — Camada de cliente (3 dias)
- `libs/uazapi.ts` — cliente HTTP tipado.
- `services/UazapiServices/*` — wrappers dos endpoints.
- Migrations para Whatsapps + WebhookEvents.
- Tests unitários do cliente.

### Fase 2 — Webhook ingestion (3 dias)
- `controllers/UazapiWebhookController.ts`.
- Rotas + middleware de validação (token + secret).
- `UazapiWebhookServices/handle*` — um handler por evento.
- Idempotência via `WebhookEvents`.
- Mantém **Baileys ainda rodando** em paralelo (feature flag).

### Fase 3 — Substituição do envio (2 dias)
- `SendWhatsAppMessage` / `SendWhatsAppMedia` chamam uazapi.
- `DeleteWhatsAppMessage`, `SetTicketMessagesAsRead` migrados.
- Feature flag `WHATSAPP_PROVIDER=uazapi|baileys` no Whatsapp model.

### Fase 4 — Sessão / QR / Status (2 dias)
- `StartWhatsAppSession`, `WhatsAppSessionController` migrados.
- `WhatsAppController` lê status da uazapi.
- UI já existente (frontend) continua funcionando — só a fonte muda.

### Fase 5 — Adjacentes (2 dias)
- Campanhas (`queues.ts`): decidir usar `/sender/*` ou nossa fila + `/send/text`.
- `typebotListener.ts`, `helpers/SendMessage.ts`, `CheckNumber`, `GetProfilePicUrl`, `ImportContactsService`.
- `wbotMonitor` (calls) → `handleCall` no webhook.

### Fase 6 — Cutover + cleanup (1 dia)
- Migrar instâncias produtivas (re-QR).
- Remover código Baileys + dependências (`baileys`, `@hapi/boom`, etc.).
- Deprecar tabelas `Baileys`, `BaileysChats`.
- Documentação atualizada.

**Estimativa total: 13-15 dias de dev** (1 desenvolvedor full-time).

---

## 10. Decisões aprovadas

| # | Decisão | Escolha | Implicação |
|---|---------|---------|-----------|
| 1 | Plano uazapi | **Conta paga** (Carlos vai fornecer URL + token) | Sem TTL nem rate limit do free; URL base via env |
| 2 | Cutover | **Único** (corta Baileys de uma vez no go-live) | Sem feature flag/coluna `provider`; Baileys removido no PR final; risco maior, código mais limpo |
| 3 | Histórico | **Manter atual no DB, começar uazapi zerado** | Sem job de re-importação; mensagens antigas seguem no banco, novas chegam só via webhook |
| 4 | Campanhas | **Bull continua, só troca cliente para `/send/text`** | `queues.ts` reaproveitado; sem dependência do `/sender/*` da uazapi |

**Implicação operacional do cutover único:** quando a Fase 6 for executada em produção, **todas as instâncias precisam refazer QR no mesmo dia**. Comunicar clientes antes.

---

## 11. Próximos passos

1. ✅ **Architect (Aria)** — análise concluída (este doc).
2. ✅ **Data Engineer (Dara)** — schema validado, migrations criadas (ver `DATA-ENGINEER-NOTES.md`).
3. 🔜 **Scrum Master (River)** — fatiar este plano em stories executáveis (uma por fase).
4. 🔜 **Dev (Dex)** — implementar story-by-story.

---

## 12. Referências

- Spec uazapi: `C:\dev\salus\uazapi-openapi-spec.yaml`
- Inventário gerado: ver seção 4 deste doc.
- ADR-XXX (Baileys upgrade) — anterior, agora obsoleto pela decisão deste ADR.
