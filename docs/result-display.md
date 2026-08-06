# Padrão de exibição de resultados

Usado pelo agente conversacional (X-Ray) e pelos cards do X-Ray.

## Campos (nessa ordem)

1. **Nome da empresa**
2. **Local** — `UF · Cidade` (UF na frente)
3. **Modelo de Negócio**
4. **Descrição**
5. **Site** — só se existir no payload (`site` / `website`)
6. **Perfil** — `https://buscafornecedor.com.br/perfil/{cnpj_basico}`

CNPJ **não** aparece como campo separado; o link de perfil usa o CNPJ básico (8 dígitos).

## Exemplo

```
1. **Distribuidora de Carnes Ideal**
   - **Local:** RS · Novo Hamburgo
   - **Modelo de Negócio:** Distribuidor
   - **Descrição:** Especializada em fornecer produtos cárnicos…
   - **Site:** https://exemplo.com.br
   - **Perfil:** https://buscafornecedor.com.br/perfil/97030720
```

## Código

- `src/search/resultDisplay.js` — helpers + prompt
- `src/xray/conversationalAgent.js` — `top` da tool já vem nesse formato
- `src/xray/xrayHtml.js` — cards alinhados
