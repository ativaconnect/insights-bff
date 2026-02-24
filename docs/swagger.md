# Swagger / OpenAPI - Insights BFF

## Endpoints HTTP da documentacao

- Swagger UI: `GET /docs`
- OpenAPI JSON: `GET /docs/openapi.json`

## Ambiente local (serverless-offline)

Com o backend rodando via `npm run dev` (porta `3001`):

- UI: `http://localhost:3001/docs`
- JSON: `http://localhost:3001/docs/openapi.json`

## Ambientes AWS (pet/dev/prd)

Depois do deploy, use a URL base do API Gateway (valor retornado em `serverless info --stage <stage>`):

- UI: `{apiBaseUrl}/docs`
- JSON: `{apiBaseUrl}/docs/openapi.json`

## Observacoes

- Endpoints publicos no Swagger nao exigem auth.
- Endpoints protegidos usam:
  - `Authorization: Bearer <jwt>`
  - `X-App-Token: <app-token>`
