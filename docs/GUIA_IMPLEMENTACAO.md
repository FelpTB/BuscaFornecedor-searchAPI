# Documento Guia para Implementação da Aplicação

## Baseado no documento "Segurança e Escalabilidade"

> **Objetivo:** Este documento consolida a arquitetura proposta em uma especificação técnica voltada para um agente de desenvolvimento. O foco é descrever os componentes, responsabilidades, fluxos, contratos e requisitos arquiteturais da aplicação, preservando a estrutura apresentada no documento original.

---

# 1. Objetivo Geral da Arquitetura

A aplicação deve ser construída sobre um **núcleo único de regras de negócio**, responsável por toda a lógica operacional do sistema.

Este núcleo será exposto por duas interfaces:

* API HTTP (FastAPI)
* MCP (Model Context Protocol)

Nenhuma regra de negócio deverá existir nas portas de entrada.

As portas apenas:

* autenticam usuários;
* validam requisições;
* encaminham comandos para a camada de serviço.

Toda a execução pesada deverá ocorrer através de processamento assíncrono utilizando filas e workers, permitindo que a resposta inicial seja rápida.

---

# 2. Arquitetura em Camadas

```
                    Internet
                        │
                Firewall / Cloudflare
                        │
                 Rate Limiter
                        │
             Validação de Payload
                        │
        ┌───────────────┴────────────────┐
        │                                │
      FastAPI                         MCP Server
        │                                │
        └───────────────┬────────────────┘
                        │
              Camada de Serviço
            (Business Rules Layer)
                        │
        ┌───────────────┼─────────────────────┐
        │               │                     │
    RabbitMQ       Banco de Dados         Observabilidade
        │
     Workers
        │
  Query Manager
        │
      Qdrant
```

A camada de serviço é o centro da arquitetura.

Nenhum componente externo deve acessar diretamente banco de dados ou workers.

---

# 3. Componentes da Aplicação

## 3.1 API (FastAPI)

Responsabilidades:

* autenticação JWT;
* validação de entrada;
* criação de buscas;
* consulta de status;
* consulta de resultados;
* encaminhamento para a camada de serviço.

Não executa buscas diretamente.

---

## 3.2 MCP Server

O MCP deve expor poucas ferramentas, extremamente específicas.

Ferramentas previstas:

* criar busca;
* consultar status;
* obter resultado;
* solicitar fallback.

O MCP nunca recebe linguagem natural diretamente.

Sempre recebe objetos estruturados.

Deve possuir:

* autorização própria;
* RBAC;
* respostas enxutas.

O objetivo é minimizar consumo de contexto e reduzir superfície de ataque.

---

## 3.3 Camada de Serviço

É o coração do sistema.

Responsável por:

* regras de negócio;
* orquestração;
* criação de operações;
* gerenciamento de filas;
* rastreabilidade.

Toda lógica deve ficar aqui.

API e MCP apenas delegam.

---

## 3.4 RabbitMQ

Toda operação pesada deve ser enviada para filas.

Exemplos:

* execução de buscas;
* fallback;
* automações;
* processamento futuro.

Cada mensagem deve possuir:

* operation_id
* correlation_id
* timestamp

Permitindo:

* idempotência;
* rastreabilidade;
* auditoria.

---

## 3.5 Workers

Os workers executam o processamento.

Fluxo inicial sugerido:

1. resolver cidade;
2. Query Manager;
3. busca regional;
4. busca nacional;
5. remoção de duplicados;
6. fallback (quando necessário).

O documento destaca que esta divisão é inicial e pode ser refinada conforme surgirem gargalos.

---

## 3.6 Query Manager

Responsável por transformar uma consulta em vetores utilizáveis.

Fluxo:

Recebe:

```
Query do comprador
```

Solicita ao modelo cinco resumos:

* serviço
* produto
* descrição
* público
* cliente

Depois gera embeddings utilizando OpenAI.

Retorna os vetores para pesquisa.

---

## 3.7 Banco Vetorial

Após geração dos embeddings:

Executar:

* busca regional
* busca nacional

Depois:

* unir resultados;
* eliminar duplicados;
* filtrar empresas.

Caso poucos resultados:

acionar fallback.

---

## 3.8 Fallback Vector

Quando a busca possuir poucos resultados.

Responsabilidade:

relaxar progressivamente critérios.

Exemplo citado:

* ignorar cidade.

Objetivo:

aumentar cobertura da busca.

---

## 3.9 Contador de Aparições

Cada empresa retornada deve possuir registro de aparição.

Funções:

* contabilizar ocorrências;
* registrar histórico.

Os registros devem ser persistidos.

---

# 4. Fluxo Completo da Busca

```
Usuário

↓

API ou MCP

↓

Autenticação

↓

Validação

↓

Camada de Serviço

↓

Criação da Operação

↓

RabbitMQ

↓

Worker

↓

Resolver Cidade

↓

Query Manager

↓

Embeddings

↓

Busca Regional

↓

Busca Nacional

↓

Merge

↓

Remoção de Duplicados

↓

Fallback (se necessário)

↓

Persistência

↓

Resultado disponível
```

A resposta inicial devolvida ao cliente é apenas um identificador da consulta, permitindo acompanhamento posterior.

---

# 5. Fluxo Assíncrono

O fluxo esperado é:

```
POST /search

↓

Validação

↓

Fila RabbitMQ

↓

Retorno imediato

{
    operation_id
}
```

Enquanto isso:

```
Worker

↓

Executa busca

↓

Persiste resultados

↓

Atualiza status
```

Depois:

```
GET /search/{operation_id}

↓

Status

↓

Resultados
```

---

# 6. Autenticação

Primeira fase:

JWT próprio.

Cada usuário deve estar associado a:

* usuário
* organização

No futuro:

Adapter para Microsoft Entra ID.

A camada de serviço não deve ser modificada com essa troca.

A autenticação é responsabilidade apenas das portas de entrada.

---

# 7. Segurança

A arquitetura utiliza **Defesa em Profundidade**.

Toda requisição passa pelas seguintes camadas:

```
Firewall

↓

Rate Limiter

↓

Validação

↓

Autorização

↓

Camada de Serviço

↓

Persistência
```

Todas as camadas realizam validações próprias.

---

# 8. Segurança Específica

## Prompt Injection

Mitigação:

O MCP nunca recebe linguagem natural.

Recebe apenas estruturas.

---

## Tool Poisoning

Toda resposta de terceiros deve:

* retornar JSON;
* passar por validação.

---

## SQL Injection

Somente:

* ORM
* Prepared Statements

---

## RCE

Nunca executar código vindo do usuário.

---

## SSRF

Whitelist de IPs e domínios.

---

## Secrets

Secret Manager ou Vault.

Rotação automática.

---

## Multi-tenancy

Todas as consultas devem obrigatoriamente utilizar:

```
tenant_id
```

A segregação deve ocorrer em todas as camadas.

---

# 9. Observabilidade

Todo fluxo deve possuir:

* logs estruturados;
* auditoria;
* métricas;
* distributed tracing;
* identificação de usuário;
* identificação da operação;
* horário.

Nunca registrar informações sensíveis.

---

# 10. Diretrizes Arquiteturais

## Não utilizar cache

O documento indica que o cache foi descartado devido à alta variabilidade das buscas entre usuários, tornando o custo de orquestração superior ao benefício esperado.

---

## Todas operações pesadas são assíncronas

Não executar:

* buscas;
* fallback;
* automações;

durante a requisição HTTP.

Sempre utilizar filas.

---

## Toda operação possui rastreabilidade

Cada fluxo deve possuir:

```
operation_id
```

e

```
correlation_id
```

---

## API e MCP compartilham exatamente a mesma lógica

Não duplicar regras.

Toda regra pertence à camada de serviço.

---

## Workers independentes

Workers devem ser facilmente separáveis em componentes menores caso apareçam gargalos.

---

## MCP minimalista

Ferramentas pequenas.

Poucas funções.

Respostas curtas.

---

## Segurança em todas as camadas

Não confiar exclusivamente na borda.

Persistência também valida.

---

## Circuit Breaker

Chamadas para serviços externos devem utilizar um mecanismo de *Circuit Breaker*, interrompendo temporariamente chamadas para dependências com falhas ou alta latência, evitando propagação de problemas pelo restante do sistema.

---

# 11. Resumo da Estrutura Esperada

| Camada            | Responsabilidade                      |
| ----------------- | ------------------------------------- |
| Firewall          | Proteção de borda                     |
| Rate Limiter      | Controle de abuso                     |
| API / MCP         | Exposição e autenticação              |
| Camada de Serviço | Regras de negócio e orquestração      |
| RabbitMQ          | Processamento assíncrono              |
| Workers           | Execução das etapas da busca          |
| Query Manager     | Geração de resumos e embeddings       |
| Banco Vetorial    | Busca regional e nacional             |
| Fallback          | Relaxamento progressivo dos critérios |
| Persistência      | Consultas, resultados e histórico     |
| Observabilidade   | Logs, auditoria, métricas e tracing   |

## 12. Requisitos Arquiteturais para o Agente de Criação

Ao implementar a aplicação, o agente deve seguir obrigatoriamente os seguintes princípios:

* **Separação de responsabilidades:** portas de entrada (API e MCP) apenas autenticam, validam e encaminham solicitações; toda lógica de negócio reside na camada de serviço.
* **Processamento assíncrono:** operações potencialmente demoradas devem ser enfileiradas no RabbitMQ e executadas por workers.
* **Arquitetura orientada a serviços internos:** componentes como Query Manager, Fallback e Workers devem possuir responsabilidades bem definidas e baixo acoplamento.
* **Segurança por camadas:** aplicar validações, autenticação, autorização e proteção contra ameaças em todas as etapas do fluxo.
* **Observabilidade completa:** todas as operações devem ser rastreáveis por meio de IDs únicos, logs estruturados e métricas.
* **Escalabilidade horizontal:** workers devem ser independentes e escaláveis conforme a carga, permitindo futuras subdivisões em serviços menores sem alteração da camada de negócio.
* **Extensibilidade:** a camada de serviço deve permanecer independente das tecnologias de autenticação (JWT, Entra ID etc.) e das interfaces consumidoras (API, MCP ou futuras integrações).

Este documento fornece uma especificação técnica consolidada da arquitetura descrita no relatório original e pode servir como base para orientar a implementação da aplicação, preservando as responsabilidades, o fluxo operacional e os requisitos não funcionais definidos na fonte.
