# Cursor AI Stack — BuscaFornecedor

```
.cursor/
├── rules/          # Project Rules (Customize → Rules)
├── skills/         # Project Skills (Customize → Skills)
├── settings.json
├── mcp.json.example
└── README.md
```

Complementos no repo:

- `docs/` — conhecimento de domínio
- `adr/` — Architecture Decision Records
- `AGENTS.md` — ponto de entrada para o agente

## Ver no Customize do agente

1. Abra **Customize** na sidebar do Agent.
2. **Rules**
   - **Project Rules:** arquivos em `.cursor/rules/*.mdc` (architecture, security, roadmap, …)
   - **User Rules:** regras globais (ex.: “BuscaFornecedor — stack e arquitetura”)
3. **Skills**
   - Skills do projeto em `.cursor/skills/*/SKILL.md`
   - Espelho em `~/.cursor/skills/` (junctions) para aparecerem também no escopo user

Se uma skill nova não listar: recarregue a janela do Cursor (`Developer: Reload Window`).

## Rules do projeto

| Rule | Tipo |
|------|------|
| `architecture.mdc` | Always Apply |
| `security.mdc` | Always Apply |
| `roadmap.mdc` | Always Apply |
| `notion-sync.mdc` | Always Apply |
| `node-express.mdc` | Globs `src/**/*.js` |
| `mcp.mdc` | Globs `src/mcp/**` |
| `qdrant-search.mdc` | Globs search modules |
| `testing.mdc` | Globs `**/*.{js,mjs}` |
| `support-apis.mdc` | Apply Intelligently |

## Skills

| Skill | Invocação |
|-------|-----------|
| `notion-sync`, `supabase-db`, `qdrant-search`, `express-api`, `mcp-tools`, `openai-embeddings`, `security-hardening`, `railway-deploy` | Agent Decides |
| `/add-auth`, `/new-endpoint`, `/new-mcp-tool`, `/new-worker` | Manual (`disable-model-invocation`) |

## Ordem de prioridade ao implementar

1. Rules always-on (`architecture`, `security`, `roadmap`)
2. Docs + ADRs relevantes
3. Skill de domínio correspondente
4. Command `/…` se for scaffold

## Habilitar MCPs externos

Copie `mcp.json.example` → `mcp.json`, preencha secrets via env do sistema/Cursor, ou use Settings → MCP. Detalhes: `docs/mcp-servers.md`.
