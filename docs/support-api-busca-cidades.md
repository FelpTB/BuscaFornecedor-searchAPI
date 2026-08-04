# Support API — busca-cidades

| | |
|--|--|
| **Live** | https://api-busca-cidades-buscafornecedor.up.railway.app/ |
| **GitHub** | https://github.com/FelpTB/API-busca-cidades |
| **Stack** | Python 3 · Flask 2.3 · gunicorn · CSV IBGE in-memory |
| **Auth** | Nenhuma |

## Propósito

Resolver um município brasileiro e listar cidades num raio (km) via Haversine. Peça-chave do passo **busca regional** (GUIA: resolver cidade → filtro Qdrant → fallback nacional).

## Endpoints

| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/` | Catálogo JSON dos endpoints |
| GET | `/api/health` · `/health` | Health + `cities_loaded` (~5570) |
| GET | `/api/cities/nearby` · `/cities/nearby` | Cidades no raio |
| GET | `/debug` | Debug (cwd, arquivos) — **expor só internamente** |

### `GET /api/cities/nearby`

| Param | Obrigatório | Notas |
|-------|-------------|-------|
| `city_name` | Sim | Nome da cidade centro |
| `uf` | Recomendado | Desambigua homônimos |
| `radius_km` | Sim | float > 0 |

**200 (resumo):**
```json
{
  "center_city": { "municipio_id", "uf", "name", "lat", "lon", "population_2021", "is_capital" },
  "nearby_cities": [{ "...", "distance_km" }],
  "total_found": 42,
  "radius_km": 50.0
}
```

Centro entra na lista com `distance_km: 0`. Ordenado por distância.

Erros: `400` (params), `404` (cidade não encontrada).

## Estrutura do repo

```
api.py              # Flask app + Haversine + rotas
cities_data.py      # fallback 10 capitais
cidades.csv         # ~5570 municípios IBGE
find_cities.py      # CLI
Procfile / railway.json
```

## Algoritmo

1. Normalizar nome (acentos, case)
2. Match exato → parcial; filtro opcional por UF
3. Scan O(n) Haversine (`R = 6371.0088`)
4. Filtrar `distance <= radius_km` e ordenar

## Consumo pelo orquestrador

```
GET .../api/cities/nearby?city_name=São Paulo&uf=SP&radius_km=50
→ nearby_cities[].name  (ou municipio_id)
→ filter Qdrant: cidade ∈ names  (busca regional)
→ se poucos hits → busca nacional (sem filtro de cidade)
```

Cache sugerido: chave `city_name|uf|radius_km`.

## Segurança

Sem auth. Desabilitar ou proteger `/debug` em produção. Preferir rede privada / API gateway.
