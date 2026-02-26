import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../logged-handler';

const resolveSpecUrl = (event: Parameters<APIGatewayProxyHandlerV2>[0]): string => {
  const forwardedPrefix = event.headers?.['x-forwarded-prefix'] ?? event.headers?.['X-Forwarded-Prefix'];
  if (forwardedPrefix) {
    const normalized = forwardedPrefix.endsWith('/') ? forwardedPrefix.slice(0, -1) : forwardedPrefix;
    return `${normalized}./docs/openapi.json`;
  }

  // Keep it relative so browser preserves custom domain mappings like /insights/docs.
  return './docs/openapi.json';
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

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => ({
  statusCode: 200,
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'
  },
  body: buildHtml(resolveSpecUrl(event))
});

export const handler = withLoggedHandler('docs/get-swagger-ui', rawHandler);


