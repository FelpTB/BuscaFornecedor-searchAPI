# Padrão de exibição de resultados

Usado pelo agente conversacional (X-Ray) e pelos cards do X-Ray.

## Campos (nessa ordem)

1. **Nome da empresa**
2. **Local** — `UF · Cidade` (UF na frente; cidade em title-case se vier em CAPS)
3. **Modelo de Negócio**
4. **Descrição**
5. **Site** — link markdown `[dominio.com.br](https://…)` (só se existir)
6. **Perfil** — `[Perfil {Nome}](https://buscafornecedor.com.br/perfil/{cnpj_basico})`

CNPJ **não** aparece como campo separado.

## Exemplo

```
1. **CASA AZEVEDO RIBEIRO**
   - **Local:** AL · Maceio
   - **Modelo de Negócio:** Distribuidor
   - **Descrição:** Distribuidora de alimentos e embalagens…
   - **Site:** [casaazevedoribeiro.com.br](https://casaazevedoribeiro.com.br)
   - **Perfil:** [Perfil Casa Azevedo Ribeiro](https://buscafornecedor.com.br/perfil/16806116)
```

A tool entrega `site_md` e `perfil_md` prontos. O X-Ray renderiza markdown (negrito + links) no balão do agente.

## Código

- `src/search/resultDisplay.js` — helpers + prompt
- `src/xray/conversationalAgent.js` — `top` da tool
- `src/xray/xrayHtml.js` — `mdToHtml` no chat
