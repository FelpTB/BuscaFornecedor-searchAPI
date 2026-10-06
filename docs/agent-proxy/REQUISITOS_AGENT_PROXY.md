# Requisitos e Características do Agent-Proxy

> **Escopo:** Custom Engine Agent (Microsoft Teams + Microsoft 365 Copilot), desenvolvido com **VS Code + Microsoft 365 Agents Toolkit**, hospedado no ambiente Microsoft (Azure).  
> **Papel:** middleware leve — orquestração, tradução de contratos e segurança de rede. **Não** concentra inteligência de negócio (busca, embeddings, rerank).  
> **Backend alvo:** BuscaFornecedor API + MCP (este repositório, Railway). Ver [INTEGRACAO_BACKEND_API.md](./INTEGRACAO_BACKEND_API.md).  
> **Roadmap Notion:** Fase 2 (VSCode + M365 Agents Toolkit), Fase 3 (Agent Proxy + identidade).

---

## 1. Visão geral e arquitetura

O Agent-Proxy intercepta o tráfego de mensagens entre as UIs Microsoft e o backend externo de IA.

| Item | Decisão |
|------|---------|
| Hospedagem | Azure App Service |
| Canal Teams | Azure Bot Service |
| Princípio | Agnóstico à lógica pesada — só orquestra APIs, traduz payloads e aplica segurança |

```
Teams / M365 Copilot
        │
        ▼
Azure Bot Service
        │
        ▼
Agent-Proxy (Azure App Service)  ← typing indicator, Adaptive Cards, OAuth Entra
        │  HTTPS + Bearer
        ▼
BuscaFornecedor API+MCP (Railway)  ← searchService, Qdrant, OpenAI, Supabase
```

---

## 2. Performance e disponibilidade

| Requisito | Critério |
|-----------|----------|
| Tempo de resposta do bot | Responder ao usuário em **&lt; 3 s** (auditoria Microsoft) |
| Typing indicator | Obrigatório se backend/IA &gt; 3 s — evitar percepção de travamento |
| Uptime | Alta resiliência; meta de zero outages em ciclos de 90 dias |

**Implicação no backend:** `POST /search/text` (e opcionalmente rerank LLM) pode ultrapassar 3 s. O proxy **deve** emitir typing imediatamente e só então aguardar a API. Não bloquear a thread do Bot Framework sem feedback.

---

## 3. Segurança e identidade

| Requisito | Detalhe |
|-----------|---------|
| Auth moderna | OAuth 2.0 via **Microsoft Entra ID** (ou GitHub com registros estáticos) |
| Segredos | Client ID / Client Secret em **Azure Key Vault** — nunca no código |
| Validação de token | Validar assinatura do Bearer **antes** de encaminhar ao backend |
| Multi-tenant | Isolar dados entre organizações (memória do proxy + Supabase/Qdrant no backend) |

**Estado atual do backend (código em `src/`):** auth híbrida `api_key` + `supabase_jwt` (shape Entra-ready em `AuthContext.provider`). Entra end-to-end no proxy = Fase 3; o proxy pode, no curto prazo, trocar token Entra → credencial de serviço / API key de serviço no backend, sem expor keys ao cliente Teams.

---

## 4. Criptografia, privacidade e dados

| Área | Requisito |
|------|-----------|
| Trânsito | TLS 1.2+ (preferir 1.3); **sem** compressão TLS (mitigar CRIME) |
| HSTS | Ativo, **≥ 180 dias**, em páginas e rotas públicas |
| Em repouso | PII em logs/temp do proxy: AES-256 (ou equivalente ≥ 256 bits) |
| Logs | Auditoria/segurança: retenção **≥ 90 dias**; **≥ 30 dias** hot |
| Alertas | Credenciais admin, malware, alteração de logs |

---

## 5. UX Teams

| Requisito | Detalhe |
|-----------|---------|
| FRE (First Run Experience) | Mensagem proativa na 1ª instalação: valor, funções, pré-requisitos |
| Anti dead-ends | Entradas fora de escopo → ajuda / comandos sugeridos |
| Comandos padrão | “Olá”, “Oi”, “Ajuda” / Help |
| Adaptive Cards | Preferir cards a texto puro para resultados estruturados |
| Mobile | Cards usáveis no Teams iOS/Android (sem scroll horizontal / overlap) |

**Mapeamento de dados:** campos de exibição já padronizados em `src/search/resultDisplay.js` (`mapResultsForDisplay`) — base para Adaptive Cards no proxy.

---

## 6. Salvaguardas de IA generativa

| Requisito | Detalhe |
|-----------|---------|
| Aviso de IA | Indicação visual de que respostas são geradas por IA |
| Report | Opção rápida de denunciar conteúdo inadequado / incorreto |
| Moderação | Proxy + backend com filtros alinhados ao Microsoft Responsible AI Standard |

---

## 7. Desenvolvimento seguro (supply chain)

| Requisito | Detalhe |
|-----------|---------|
| Input hardening | Sanitizar/validar texto do Teams **antes** do payload ao backend (anti RCE/injeção) |
| PoLP | `bots.scopes` no `manifest.json` = mínimo para busca de fornecedores |
| Code review | Merge em produção só com peer review; MFA nos repositórios |

**Backend já faz:** Zod em REST/MCP (`schemas/searchText.js`), allowlist de filtros, body size limit, Helmet. O proxy **não** deve confiar só nisso — validar na borda Teams também.

---

## 8. Stack de desenvolvimento (acordado)

- **IDE:** VS Code  
- **Toolkit:** Microsoft 365 Agents Toolkit  
- **Tipo:** Custom Engine Agent / Agent-Proxy  
- **Hospedagem Microsoft:** Azure App Service + Azure Bot Service  
- **Backend:** este repo (Express + MCP Streamable HTTP, Railway)

---

## Referências internas

- Integração detalhada com a API: [INTEGRACAO_BACKEND_API.md](./INTEGRACAO_BACKEND_API.md)  
- Código: `src/` (verdade operacional)  
- Notion: Document Hub + Roadmap Fases 2–3 / 7 (certificação)
