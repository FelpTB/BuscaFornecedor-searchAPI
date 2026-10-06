# Guia de uso da BuscaFornecedor API

Este guia explica, do zero, como usar a API de busca de fornecedores B2B: os conceitos por trás da busca, como fazer a primeira chamada, como ajustar os resultados e como resolver os problemas mais comuns.

| Se você quer… | Leia |
|---------------|------|
| Entender a busca e fazer a primeira chamada | Este guia |
| Consultar uma rota específica (entrada, saída, erros) | [Endpoints](./ENDPOINTS.md) |
| Detalhes de autenticação, limites, MCP e integração | [Referência](./REFERENCE.md) |

> A página interativa desta documentação fica em `GET /docs` no próprio servidor da API.

---

## 1. O que a API faz

A API recebe uma descrição em linguagem natural do que o comprador precisa (por exemplo, *"locação de andaimes para reforma de fachadas"*) e devolve uma lista ordenada de fornecedores compatíveis, com dados de contato, localização e descrição.

Ela pode ser usada de três formas, todas com o mesmo motor de busca:

| Forma | Para quem | Como |
|-------|-----------|------|
| **REST** | Sistemas, backends, automações (n8n) | `POST /search/text` |
| **MCP** | Agentes de IA (Copilot, Claude, Cursor, Agent-Proxy) | Tool `search_text` em `/mcp` |
| **X-Ray** | Time interno, testes e QA | Interface web em `/search/xray` |

---

## 2. Conceitos essenciais

### 2.1 O perfil do fornecedor e as 5 dimensões

Cada fornecedor da base tem um perfil dividido em **dimensões**. Cada dimensão vira um vetor (uma "impressão digital" do significado do texto), e a busca compara o seu pedido com cada uma delas separadamente.

| Dimensão | O que representa | Exemplo (empresa de andaimes) |
|----------|------------------|-------------------------------|
| `produto` | O que a empresa vende | "Andaimes tubulares, escoras metálicas" |
| `servico` | O que a empresa presta como serviço | "Locação e montagem de andaimes" |
| `descricao` | Resumo geral da empresa | "Empresa especializada em locação de andaimes para construção civil…" |
| `publico` | Quem a empresa atende (perfil de cliente) | "Construtoras, empreiteiras, empresas de manutenção predial" |
| `cliente` | Clientes citados pela empresa | "Construtora X, Condomínio Y" |

Além delas, existe o **BM25**, um índice de palavras-chave sobre o perfil completo. Ele é útil quando o pedido tem termos exatos, como modelos, marcas e siglas.

> As dimensões ativas no ambiente aparecem em `GET /config` → `dimension_keys`.

### 2.2 Como uma busca acontece, passo a passo

```
 Seu pedido: "locação de andaimes para obras"
        │
        ▼
 1. Validação ........ campos, filtros permitidos, limites
        │
        ▼
 2. Pesos ............ define quanto cada dimensão vale (preset, foco ou pesos manuais)
        │
        ▼
 3. Embeddings ....... o texto vira vetor (OpenAI text-embedding-3-small)
        │
        ▼
 4. Busca híbrida .... Qdrant compara com cada dimensão + palavras-chave (BM25)
        │               dois caminhos (BM25 primeiro / semântico primeiro) fundidos por RRF
        ▼
 5. Rerank opcional .. um LLM reordena o topo da lista
        │
        ▼
 6. Resposta ......... lista ordenada + search_id + pesos efetivamente usados
        │
        └──► (em segundo plano) histórico da consulta e contagem de aparições
```

O histórico (passo final) **nunca atrasa a resposta**: ele é gravado depois, de forma assíncrona.

### 2.3 O que são os pesos

Os pesos dizem **quanto cada dimensão importa** na nota final de um fornecedor. Eles somam 1,0.

Exemplo: com `servico: 0.48` e `publico: 0.04`, uma empresa cujo *serviço* bate com o pedido sobe muito mais do que uma empresa que apenas atende o mesmo *público*.

Você não precisa escolher pesos na mão. A forma recomendada é usar as **pré-configurações** e o **foco da busca** (seção 5), que montam os pesos automaticamente.

### 2.4 Busca por palavra-chave (BM25)

Quando o BM25 está configurado no ambiente, ele fica **ligado por padrão** e usa o próprio texto do pedido. Com ele ativo, a API reserva **0,20** do peso total para palavras-chave e distribui os outros **0,80** entre as dimensões.

- Para reforçar termos que precisam aparecer (modelo, marca, sigla), use `exact_terms`.
- Para desligar, envie `"bm25": false`.

---

## 3. Primeiros passos

Os exemplos usam duas variáveis:

```bash
export BASE="https://<seu-servico>.up.railway.app"   # ou http://127.0.0.1:3000 em desenvolvimento
export API_KEY="sk_bf_..."                             # obtida no passo 3.1
```

### 3.1 Criar conta e obter a API key

```bash
curl -sS -X POST "$BASE/auth/register-buyer" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "compras@minhaempresa.com.br",
    "nome": "Maria Silva",
    "empresa_nome": "Minha Empresa Ltda",
    "password": "umaSenhaForte123"
  }'
```

A resposta traz `api_key.key`, que começa com `sk_bf_`. **Guarde agora**: ela é exibida uma única vez. Se a conta já existir, use `POST /auth/login-buyer` com e-mail e senha.

### 3.2 Ler o contrato da busca

```bash
curl -sS "$BASE/config"
```

O `/config` informa as dimensões, os filtros permitidos, os limites, as pré-configurações disponíveis e os valores de foco. Vale ler uma vez na inicialização do seu sistema e guardar em cache.

### 3.3 Fazer a primeira busca

**curl**

```bash
curl -sS -X POST "$BASE/search/text" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "locação de andaimes para reforma de fachadas",
    "weight_preset": "escopo",
    "search_focus": "servico",
    "filter": { "uf": "SP" },
    "final_limit": 5
  }'
```

**JavaScript (Node 18+ / navegador)**

```js
const res = await fetch(`${BASE}/search/text`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    query: "locação de andaimes para reforma de fachadas",
    weight_preset: "escopo",
    search_focus: "servico",
    filter: { uf: "SP" },
    final_limit: 5,
  }),
});
if (!res.ok) throw new Error((await res.json()).error);
const data = await res.json();
for (const r of data.results) console.log(r.posicao, r.payload.nome_empresa, r.payload.cidade);
```

**Python**

```python
import requests

res = requests.post(
    f"{BASE}/search/text",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "query": "locação de andaimes para reforma de fachadas",
        "weight_preset": "escopo",
        "search_focus": "servico",
        "filter": {"uf": "SP"},
        "final_limit": 5,
    },
    timeout=30,
)
res.raise_for_status()
for r in res.json()["results"]:
    print(r["posicao"], r["payload"]["nome_empresa"], r["payload"]["cidade"])
```

### 3.4 Entendendo a resposta

Resposta resumida (dados fictícios):

```json
{
  "search_id": "6f067265-f8a5-4e7b-bf95-5b0b52241bb0",
  "results": [
    {
      "posicao": 1,
      "id": "1802767019",
      "score_final": 0.748,
      "score_rrf": 0.181818,
      "scores": { "produto": 0, "servico": 0.7621, "descricao": 0.7223, "publico": 0.5289, "cliente": 0, "bm25": 0.9385 },
      "paths": ["A#1", "B#1"],
      "in_both": true,
      "payload": {
        "nome_empresa": "Andaimes Exemplo Ltda",
        "modelo_negocio": "Prestador de Serviço",
        "cidade": "SAO PAULO",
        "uf": "SP",
        "servico": "Locação de andaimes fachadeiros e tubulares",
        "publico": "Construtoras, empreiteiras, manutenção predial",
        "site": "https://www.exemplo.com.br",
        "cnpj": "12345678"
      }
    }
  ],
  "weights_used": { "produto": 0, "servico": 0.48, "descricao": 0.24, "publico": 0.04, "cliente": 0.04, "bm25": 0.2 },
  "weights_source": "preset",
  "weight_preset": "escopo",
  "search_focus": "servico",
  "latency_ms": 842,
  "telemetry_queued": true
}
```

| Campo | Como interpretar |
|-------|------------------|
| `search_id` | Identificador único da busca. Guarde para correlacionar logs, avaliar a qualidade ou consultar o histórico. Também vem no header `X-Search-Id`. |
| `results[].posicao` | Posição no ranking (1 = mais relevante). |
| `results[].score_final` | Nota final usada na ordenação. Serve para comparar resultados **da mesma busca**, não entre buscas diferentes. |
| `results[].scores` | Similaridade em cada dimensão. Ajuda a entender **por que** a empresa apareceu. Dimensão com peso 0 aparece com 0. |
| `results[].paths` / `in_both` | Em qual caminho da busca híbrida a empresa apareceu (`A` = palavras-chave primeiro, `B` = semântico primeiro). `in_both: true` costuma indicar boa aderência. |
| `results[].payload` | Dados do fornecedor: nome, cidade, UF, site, contatos, produtos, serviços, público etc. |
| `weights_used` | Pesos realmente aplicados, já com foco e BM25. É a forma mais confiável de conferir a configuração. |
| `weights_source` | De onde vieram os pesos: `explicit` (você enviou `weights`), `preset` (`weight_preset`) ou `default` (pesos iguais). |
| `telemetry_queued` | Se o histórico da consulta foi enfileirado para gravação. |

---

## 4. Montando uma boa busca

### 4.1 Escrevendo o pedido (`query`)

Descreva **o que** você precisa e, se quiser, **para quem**. Frases naturais funcionam melhor do que listas de palavras soltas.

| Menos eficaz | Mais eficaz |
|--------------|-------------|
| `andaime` | `locação de andaimes para reforma de fachadas de prédios` |
| `concreto SP construtora` | `concreto usinado para construtoras de edifícios residenciais` + `filter: { "uf": "SP" }` |

Localização funciona melhor como **filtro** (`uf`, `cidade`) do que dentro do texto.

### 4.2 Textos diferentes por dimensão (`queries`)

Por padrão, o mesmo texto é comparado com todas as dimensões. Se quiser ser mais preciso, envie um texto para cada dimensão. As dimensões omitidas usam o `query`.

```json
{
  "query": "impermeabilização para condomínios",
  "queries": {
    "servico": "impermeabilização de lajes, coberturas e reservatórios",
    "publico": "condomínios residenciais, síndicos e administradoras"
  }
}
```

### 4.3 Filtros (`filter` e `filter_not`)

Filtros **restringem** os resultados; eles não mudam a ordem. Só são aceitas as chaves permitidas no ambiente (veja `GET /config` → `payload_keys` e `payload_keys_full_text`).

| Tipo de chave | Chaves padrão | Como compara |
|---------------|---------------|--------------|
| Exata (keyword) | `uf`, `cidade`, `modelo_negocio`, `nome_empresa`, `cnpj` | Valor igual. `uf` e `cidade` são normalizados (maiúsculas, sem acento). |
| Texto (full-text) | `descricao`, `endereco`, `publico`, `site`, `email`, `certificacoes` | Contém as palavras informadas. |

Regras de combinação:

- **Lista = OU**: `{ "uf": ["SP", "RJ"] }` traz SP **ou** RJ. A string `"SP,RJ"` funciona igual.
- **Várias chaves = E**: `{ "uf": "SP", "modelo_negocio": "Fabricante" }` exige as duas condições.
- **`filter_not` exclui**: `{ "descricao": "combustível" }` remove empresas cuja descrição contém "combustível".

```json
{
  "query": "estrutura metálica para galpões industriais",
  "filter": { "uf": ["SP", "MG"], "modelo_negocio": "Fabricante" },
  "filter_not": { "descricao": "revenda" }
}
```

### 4.4 Termos exatos (`exact_terms`)

Use quando um termo **precisa** pesar na busca por palavra-chave: modelo, marca, norma, sigla.

```json
{ "query": "estaca hélice contínua para obras verticais", "exact_terms": ["hélice contínua"] }
```

Os termos são sempre somados ao `bm25_query` (que, por padrão, é o próprio `query`).

### 4.5 Quantidade de resultados

| Campo | Padrão | Máximo | Para que serve |
|-------|--------|--------|----------------|
| `final_limit` | 20 | 100 | Quantos fornecedores voltam na resposta. |
| `limit_per_vector` | 50 | 200 | Quantos candidatos cada dimensão traz antes da fusão. Aumente só se faltar resultado relevante. |

Para chat e cards, 5 a 10 resultados costumam bastar.

### 4.6 Rerank com LLM (`rerank`)

Com `"rerank": true` (ou `?rerank=1`), um modelo de linguagem relê os 20 primeiros candidatos e os reordena por relevância. Melhora a precisão do topo, mas **aumenta a latência** em alguns segundos. A resposta passa a incluir o bloco `rerank` (modelo, tokens usados, tamanho do pool).

---

## 5. Pré-configurações e foco da busca

Estes dois campos são a forma mais simples de ajustar o resultado **sem entender vetores**. Os dois são opcionais e podem ser usados juntos.

### 5.1 Pré-configuração (`weight_preset`)

Escolhe um conjunto de pesos pronto, de acordo com o que mais importa para o comprador.

| Valor | Use quando | produto | serviço | descrição | público | cliente |
|-------|-----------|---------|---------|-----------|---------|---------|
| `escopo` | O mais importante é **o que** a empresa faz (natureza do produto ou serviço). | 0,30 | 0,30 | 0,30 | 0,05 | 0,05 |
| `equilibrado` | Quer um meio-termo entre escopo e público. | 0,25 | 0,25 | 0,25 | 0,125 | 0,125 |
| `publico_alvo` | Quer priorizar empresas que **atendem o seu perfil** de cliente (ex.: condomínios, indústrias, órgãos públicos). | 0,20 | 0,20 | 0,20 | 0,20 | 0,20 |

Valores antes do BM25. Com BM25 ativo, todos são multiplicados por 0,8 e o BM25 recebe 0,20.

> **Por que o `publico_alvo` não tem peso maior em público?** Nos testes, quando público + cliente passam de cerca de 0,4, a busca começa a trazer empresas que atendem o público certo mas vendem outra coisa. Exemplo: numa busca por concreto, apareciam fábricas de portas que atendem construtoras. Os valores acima são o ponto em que a busca prioriza o público sem perder a aderência ao que foi pedido. Veja a seção 5.6.

A API aceita variações de escrita: `"Escopo"`, `"Público Alvo"`, `"publico-alvo"`, `"Equilibrada"`.

### 5.2 Foco da busca (`search_focus`)

Diz se o comprador procura um **produto**, um **serviço** ou os dois.

| Valor | Efeito |
|-------|--------|
| `produto` | Zera o vetor de **serviço**. Empresas são avaliadas pelo que vendem. |
| `servico` | Zera o vetor de **produto**. Empresas são avaliadas pelo serviço que prestam. |
| `mista` | Mantém os dois vetores ativos (mesmo efeito de não enviar o campo). |

A API aceita `"Produto"`, `"Serviço"`, `"servicos"`, `"misto"`, `"ambos"`.

### 5.3 Como os dois se combinam

Quando o foco zera um vetor, o peso dele **não se perde**: ele é redistribuído de acordo com a pré-configuração escolhida.

| Pré-configuração | Para onde vai o peso do vetor zerado |
|------------------|--------------------------------------|
| `escopo` | Todo para a dimensão em foco (produto ou serviço). |
| `equilibrado` | Dividido igualmente entre todas as dimensões que continuam ativas. |
| `publico_alvo` | Dividido igualmente entre `publico` e `cliente`. |
| Sem preset (pesos manuais ou padrão) | Todo para a dimensão em foco. |

**Pesos efetivos com BM25 ativo** (é o que aparece em `weights_used`):

| Pré-configuração | Foco | produto | serviço | descrição | público | cliente | bm25 |
|------------------|------|---------|---------|-----------|---------|---------|------|
| `escopo` | `mista` | 0,24 | 0,24 | 0,24 | 0,04 | 0,04 | 0,20 |
| `escopo` | `produto` | 0,48 | 0 | 0,24 | 0,04 | 0,04 | 0,20 |
| `escopo` | `servico` | 0 | 0,48 | 0,24 | 0,04 | 0,04 | 0,20 |
| `equilibrado` | `mista` | 0,20 | 0,20 | 0,20 | 0,10 | 0,10 | 0,20 |
| `equilibrado` | `produto` | 0,25 | 0 | 0,25 | 0,15 | 0,15 | 0,20 |
| `equilibrado` | `servico` | 0 | 0,25 | 0,25 | 0,15 | 0,15 | 0,20 |
| `publico_alvo` | `mista` | 0,16 | 0,16 | 0,16 | 0,16 | 0,16 | 0,20 |
| `publico_alvo` | `produto` | 0,16 | 0 | 0,16 | 0,24 | 0,24 | 0,20 |
| `publico_alvo` | `servico` | 0 | 0,16 | 0,16 | 0,24 | 0,24 | 0,20 |

**Exemplos práticos**

| Situação do comprador | Configuração sugerida |
|-----------------------|-----------------------|
| "Preciso alugar andaimes" (serviço, o que importa é a atividade) | `weight_preset: "escopo"`, `search_focus: "servico"` |
| "Quero comprar esquadrias de alumínio" (produto) | `weight_preset: "escopo"`, `search_focus: "produto"` |
| "Impermeabilização, de preferência quem já atende condomínios" | `weight_preset: "publico_alvo"`, `search_focus: "servico"` |
| "Estrutura metálica, fabricação e montagem" (não sei se é produto ou serviço) | `weight_preset: "equilibrado"`, `search_focus: "mista"` |

### 5.4 Ordem de prioridade

1. Se `weights` for enviado, ele vale e **`weight_preset` é ignorado**.
2. Senão, se `weight_preset` for enviado, os pesos do preset são usados.
3. Senão, todas as dimensões recebem o mesmo peso.

O `search_focus` é aplicado **por cima** de qualquer uma das três opções, e o BM25 é ajustado por último.

### 5.5 Como conferir o que foi aplicado

Toda resposta traz:

- `weights_used`: os pesos finais, já com foco e BM25;
- `weights_source`: `explicit`, `preset` ou `default`;
- `weight_preset` e `search_focus`: os valores efetivamente aplicados, já normalizados.

### 5.6 De onde vieram os números

Os pesos das pré-configurações foram calibrados com uma bateria de testes em projetos de construção civil:

- 12 tipos de pedido (concreto, impermeabilização, andaimes, fundações, drywall, terraplenagem etc.), cada um escrito de 3 formas diferentes;
- 159 combinações de pesos e cerca de 5.700 buscas reais;
- cada fornecedor retornado recebeu, de um avaliador automático (LLM), uma nota de aderência ao **escopo** e outra ao **público**.

Para repetir ou estender a bateria a outro setor:

```bash
npm run eval:presets                                         # construção civil (padrão)
node scripts/eval/weight-presets.mjs --dataset=meu-setor.json  # outro conjunto de pedidos
```

O conjunto de pedidos fica em `scripts/eval/queries-construcao-civil.json`, e os resultados em `eval-output/weight-presets/`.

---

## 6. Pesos manuais (avançado)

Se precisar de controle total, envie `weights` com as dimensões de `GET /config` → `dimension_keys`.

```json
{
  "query": "pisos industriais para centros de distribuição",
  "weights": { "produto": 0.1, "servico": 0.4, "descricao": 0.2, "publico": 0.2, "cliente": 0.1 }
}
```

Regras:

| Situação | Comportamento |
|----------|---------------|
| BM25 ativo e `weights` **sem** a chave `bm25` | A API reserva 0,20 para o BM25 e reescala os seus pesos proporcionalmente para 0,80. A soma enviada não precisa ser exatamente 1. |
| `weights` **com** a chave `bm25` | A soma de todas as chaves precisa ser 1,0. |
| BM25 desligado (`"bm25": false`) | A soma das dimensões precisa ser 1,0. |

Pesos manuais têm prioridade sobre `weight_preset`, mas o `search_focus` ainda é aplicado por cima.

---

## 7. Depois da busca

### 7.1 `search_id` e histórico

Cada busca autenticada gera um `search_id`. Alguns segundos depois, a consulta é gravada no histórico do comprador, com parâmetros, pesos e resultados. Para conferir, use `GET /auth/consultas/{search_id}`. Se a gravação ainda não terminou, a resposta pode ser `404`.

### 7.2 Avaliar a qualidade da busca

O comprador pode registrar se o resultado foi bom:

```bash
curl -sS -X PATCH "$BASE/auth/consultas/$SEARCH_ID/qualidade" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "qualidade": "Bom" }'
```

Valores aceitos: `Ótimo`, `Bom`, `Ruim`, `Péssimo`. Essas avaliações ajudam a calibrar a busca.

### 7.3 Exibindo os resultados

Para interfaces (cards, chat, Teams), mostre poucos campos e bem formatados:

| Campo do `payload` | Uso sugerido |
|--------------------|--------------|
| `nome_empresa` | Título do card |
| `uf` + `cidade` | Localização ("SP · São Paulo") |
| `modelo_negocio` | Selo (Fabricante, Distribuidor, Prestador de Serviço…) |
| `descricao` | Texto curto (até ~400 caracteres) |
| `site` | Botão "Abrir site" |
| `cnpj` (8 primeiros dígitos) | Link do perfil: `https://buscafornecedor.com.br/perfil/{cnpj_basico}` |

---

## 8. Usando com agentes de IA (MCP)

O servidor MCP expõe as mesmas funções da API REST como *tools*. Endpoint: `POST /mcp` (MCP Streamable HTTP), com a mesma autenticação.

| Tool | Equivale a |
|------|------------|
| `get_config` | `GET /config` |
| `search_text` | `POST /search/text` (aceita os mesmos campos, inclusive `weight_preset` e `search_focus`) |
| `list_conversations` | `GET /conversations` |
| `get_conversation` | `GET /conversations/:id` |
| `delete_conversation` | `DELETE /conversations/:id` |

Exemplo com o SDK oficial (Node):

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } },
});
const client = new Client({ name: "meu-agente", version: "1.0.0" });
await client.connect(transport);

const result = await client.callTool({
  name: "search_text",
  arguments: {
    query: "instalação elétrica predial para hospitais",
    weight_preset: "publico_alvo",
    search_focus: "servico",
    final_limit: 5,
  },
});
const data = JSON.parse(result.content[0].text);
console.log(data.results.map((r) => r.payload.nome_empresa));
await client.close();
```

Para configurar em clientes como Cursor ou Claude Desktop, aponte para `https://<seu-servico>/mcp` com o header `Authorization: Bearer sk_bf_…`.

---

## 9. Erros comuns e como resolver

| Sintoma | Causa provável | Como resolver |
|---------|----------------|---------------|
| `401` "Busca requer autenticação" | Sem header de autenticação ou chave inválida | Envie `Authorization: Bearer sk_bf_…` ou `X-Api-Key`. |
| `403` | Chave sem permissão de busca, conta sem perfil de comprador ou cota esgotada | Confira `GET /auth/me` → `comprador.buscasRealizadas` e `limiteBuscas`. |
| `400` "Chaves de filtro não permitidas: telefone" | Filtro com chave fora da lista | Use só as chaves de `GET /config` → `payload_keys` / `payload_keys_full_text`. |
| `400` "search_focus: Invalid option" | Valor fora de `produto`, `servico`, `mista` | Corrija o valor. A API já aceita acentos e maiúsculas. |
| `400` "Campo 'weights' inválido" | Soma diferente de 1,0 com `bm25` em `weights` ou BM25 desligado | Ajuste a soma ou prefira `weight_preset`. |
| `429` "Too many search requests" | Mais de 120 buscas por minuto com a mesma chave | Reduza a frequência ou distribua entre chaves. |
| Resultados com o público certo, mas fora do escopo | Peso alto demais em `publico`/`cliente` | Use `weight_preset: "escopo"` ou `"equilibrado"`. |
| Resultados genéricos para um modelo ou marca específicos | Termo exato diluído na busca semântica | Envie o termo em `exact_terms`. |
| Poucos resultados com filtro de cidade | Filtro muito restritivo | Filtre por `uf` ou por uma lista de cidades vizinhas. |

Toda resposta de erro traz `request_id`. Informe esse valor ao pedir suporte.

---

## 10. Boas práticas

- Leia `GET /config` na inicialização e respeite os limites informados.
- Prefira `weight_preset` + `search_focus` a pesos manuais.
- Coloque localização em `filter`, não no texto do pedido.
- Peça 5 a 10 resultados para interfaces de chat.
- Use `rerank` só quando a precisão do topo for mais importante do que a latência.
- Guarde o `search_id` para avaliação de qualidade e suporte.
- Nunca exponha a API key no navegador ou em repositórios. Em integrações (ex.: Agent-Proxy), guarde-a em um cofre de segredos.

---

## 11. Glossário

| Termo | Significado |
|-------|-------------|
| **Dimensão** | Uma parte do perfil do fornecedor (produto, serviço, descrição, público, cliente) comparada separadamente com o pedido. |
| **Embedding / vetor** | Representação numérica do significado de um texto, que permite comparar textos por sentido e não só por palavras iguais. |
| **BM25** | Busca clássica por palavras-chave. Complementa a busca semântica em termos exatos. |
| **RRF** | *Reciprocal Rank Fusion*: técnica que combina rankings de caminhos diferentes da busca em uma lista única. |
| **Rerank** | Reordenação final feita por um modelo de linguagem. |
| **Pré-configuração** | Conjunto pronto de pesos (`escopo`, `equilibrado`, `publico_alvo`). |
| **Foco** | Escolha entre produto, serviço ou ambos, que zera um dos vetores. |
| **MCP** | *Model Context Protocol*: padrão para agentes de IA chamarem ferramentas externas. |
