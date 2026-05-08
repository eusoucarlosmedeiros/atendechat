# EPIC-001: Migração Baileys → uazapi

- **Status:** In Progress
- **Owner:** Carlos Medeiros
- **Started:** 2026-05-08
- **Target:** Cutover em ~13-15 dias úteis (1 dev fulltime)
- **Reference:** `docs/architecture/ADR-001-baileys-to-uazapi.md`

---

## Goal

Substituir 100% da camada Baileys (SDK in-process) pelo **uazapi** (API HTTP externa + webhook), eliminando os bugs crônicos de envio (LID/PN, getMessage retry, churn de versão) e reduzindo carga de manutenção.

## Scope

- Backend (`backend/src`): refatoração completa da camada WhatsApp.
- Schema PostgreSQL: adicionar campos uazapi em `Whatsapps`, criar `WebhookEvents`, ajustar `Messages`.
- Frontend: **nenhuma mudança** (status/QR continuam vindo via socket.io igual antes).

## Out of Scope

- Re-importação de histórico (decisão #3 ADR: começa zerado na uazapi).
- Migração in-place de sessões (cutover obriga re-QR de todos os clientes).
- Fork/self-host da uazapi (decisão #1 ADR: conta paga existente).

## Stories (refinadas pelo PO em 2026-05-09)

| # | Story | Estimativa | Bloqueia | Status |
|---|-------|-----------|----------|--------|
| 01.01 | Schema + migrations | 0.5d | - | ✅ Done (Dara) |
| 01.02 | Cliente uazapi + wrappers | 2d | 03,04,05,06 | ✅ GO (PO 8/10) |
| 01.03 | Webhook controller + handlers | 3d | 06d, 07 | ✅ GO (PO 7/10) — escopo grande, pode fatiar 03a/03b |
| 01.04 | Send services via uazapi | 2d | 07 | ✅ GO (PO 9/10) |
| 01.05 | Sessão / QR / Status | 2d | 07 | ✅ GO (PO 8/10) |
| 01.06a | Campanhas + helpers/SendMessage | 1d | 07 | ✅ GO (fatiada de 01.06) |
| 01.06b | Typebot | 0.5d | 07 | ✅ GO (fatiada de 01.06) |
| 01.06c | CheckNumber + ProfilePic + ImportContacts | 0.5d | 07 | ✅ GO (fatiada de 01.06) |
| 01.06d | Calls (delete wbotMonitor) | 0.5d | 07 | ✅ GO (depende de 01.03 Done) |
| 01.07 | Cutover (remoção Baileys) | 1d | 08 | ✅ GO (PO 10/10) |
| 01.08 | Drop tabelas legacy (sprint+1) | 0.5d | - | ✅ GO (PO 10/10) |
| **Total** | | **~13d** | | 11 stories |

## Dependency graph (atualizado pós-PO review)

```
01.01 (schema) ✅
   │
01.02 (client) ──┬──► 01.03 (webhook) ───┬──► 01.06d (calls) ─┐
                 │                       │                    │
                 ├──► 01.04 (send) ──────┤                    │
                 │                       │                    │
                 ├──► 01.05 (session) ───┤                    ├──► 01.07 (cutover) ──► 01.08 (drop)
                 │                       │                    │
                 ├──► 01.06a (camp) ─────┤                    │
                 │                       │                    │
                 ├──► 01.06b (typebot) ──┤                    │
                 │                       │                    │
                 └──► 01.06c (check/pic) ┘                    │
                                                              │
                          (todas as 01.06* mergeadas) ────────┘
```

**Caminho crítico:** 01.02 → 01.03 → 01.06d → 01.07 → 01.08 (~9 dias).
**Paralelismo:** 01.04, 01.05, 01.06a/b/c podem ser feitas em paralelo a 01.03 por dev diferente, ou em sequência por 1 dev.

## Acceptance criteria do Epic

1. ✅ `Whatsapps` tem 4 campos uazapi populados após StartWhatsAppSession.
2. ✅ Webhook `/uazapi/webhook/:secret` recebe e processa eventos sem duplicação.
3. ✅ Mensagem enviada pelo painel chega ao destinatário (caminho golden + grupo + mídia).
4. ✅ Mensagem recebida cria `Ticket` + `Message` exatamente como antes.
5. ✅ QR no frontend funciona (login + reconexão).
6. ✅ Campanhas Bull continuam funcionando.
7. ✅ Pacote `baileys` removido do `package.json`.
8. ✅ Testes manuais cobertos: envio 1:1, envio grupo, envio mídia, recebimento, ack, deletar, marcar lido.

## Risks (do ADR)

- 🔴 Cutover obriga re-QR — comunicar clientes 48h antes.
- 🟡 Custo recorrente uazapi (Carlos confirmou conta paga).
- 🟡 Webhook sem HMAC — proteger por URL secreta (16+ bytes random) + token de instância.

— River, organizando o caos 🌊
