# Cursor AI Stack — BuscaFornecedor

```
.cursor/
├── rules/          # comportamento permanente do agente
├── skills/         # especialistas + /commands
├── mcp.json.example
└── README.md       # este arquivo
```

Complementos no repo:

- `docs/` — conhecimento de domínio
- `adr/` — Architecture Decision Records
- `AGENTS.md` — ponto de entrada para o agente

## Ordem de prioridade ao implementar

1. Rules always-on (`architecture`, `security`, `roadmap`)
2. Docs + ADRs relevantes
3. Skill de domínio correspondente
4. Command `/…` se for scaffold

## Habilitar MCPs externos

Copie `mcp.json.example` → `mcp.json`, preencha secrets via env do sistema/Cursor, ou use Settings → MCP. Detalhes: `docs/mcp-servers.md`.
