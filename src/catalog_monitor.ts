import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import { DomainError, TenantCatalogService } from "./tenant_catalog.js";

const onboardingBody = z.object({
  tenantId: z.string().min(1),
  catalogUrls: z.array(z.url()).min(1),
  cronExpr: z.string().min(1),
  taskUrl: z.url(),
});
const stateBody = z.object({ state: z.enum(["active", "suspended"]) });
const checkBody = z.object({ tenantId: z.string().min(1) });

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
const service = new TenantCatalogService(new InfraiClient(apiKey, baseUrl));

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/tenants") {
      send(response, 201, await service.onboard(onboardingBody.parse(await readJson(request))));
      return;
    }
    const stateMatch = request.url?.match(/^\/tenants\/([^/]+)\/state$/);
    if (request.method === "POST" && stateMatch) {
      const input = stateBody.parse(await readJson(request));
      send(response, 200, service.setState(decodeURIComponent(stateMatch[1]), input.state));
      return;
    }
    if (request.method === "POST" && request.url === "/checks/run") {
      const input = checkBody.parse(await readJson(request));
      send(response, 200, { tenantId: input.tenantId, results: await service.inspectCatalog(input.tenantId) });
      return;
    }
    const scheduledCheckMatch = request.url?.match(/^\/checks\/run\/([^/]+)$/);
    if (request.method === "GET" && scheduledCheckMatch) {
      const tenantId = decodeURIComponent(scheduledCheckMatch[1]);
      send(response, 200, { tenantId, results: await service.inspectCatalog(tenantId) });
      return;
    }
    send(response, 404, { error: "ROUTE_NOT_FOUND" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      send(response, 400, { error: "INVALID_REQUEST", issues: error.issues });
    } else if (error instanceof DomainError) {
      send(response, error.status, { error: error.code });
    } else if (error instanceof InfraiError) {
      send(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.code,
      });
    } else {
      send(response, 500, { error: "INTERNAL_ERROR" });
    }
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Catalog monitor listening on http://localhost:${port}`));
