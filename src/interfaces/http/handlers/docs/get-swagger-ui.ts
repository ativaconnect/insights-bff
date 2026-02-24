import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const resolveSpecUrl = (event: Parameters<APIGatewayProxyHandlerV2>[0]): string => {
  const rawPath = event.rawPath ?? '/docs';
  const docsBase = rawPath.endsWith('/docs') ? rawPath.slice(0, -'/docs'.length) : '';
  return `${docsBase}/docs/openapi.json`;
};

const buildHtml = (specUrl: string): string => `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Insights BFF - Swagger</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #f3f6fb; }
      #swagger-ui { max-width: 1200px; margin: 0 auto; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '${specUrl}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        displayRequestDuration: true,
        persistAuthorization: true,
      });
    </script>
  </body>
</html>`;

export const handler: APIGatewayProxyHandlerV2 = async (event) => ({
  statusCode: 200,
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'
  },
  body: buildHtml(resolveSpecUrl(event))
});
