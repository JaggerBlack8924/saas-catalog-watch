import assert from "node:assert/strict";
import test from "node:test";
import { DomainError, TenantCatalogService } from "../src/tenant_catalog.js";

test("a suspended tenant cannot run its scheduled catalog inspection", async () => {
  let scrapeCalls = 0;
  let scheduledTask = "";
  const infrai = {
    schedule: async (_cronExpr: string, task: string) => {
      scheduledTask = task;
      return { job_id: "job_demo" };
    },
    scrape: async () => {
      scrapeCalls += 1;
      return { content: "Starter: 29" };
    },
  };
  const service = new TenantCatalogService(infrai);
  const account = await service.onboard({
    tenantId: "acme",
    catalogUrls: ["https://vendor.example/catalog"],
    cronExpr: "0 9 * * 1",
    taskUrl: "https://monitor.example/checks/run",
  });

  assert.equal(account.state, "active");
  assert.equal(account.scheduleJobId, "job_demo");
  assert.equal(scheduledTask, "https://monitor.example/checks/run/acme");
  service.setState("acme", "suspended");
  await assert.rejects(
    service.inspectCatalog("acme"),
    (error: unknown) => error instanceof DomainError && error.code === "ACCOUNT_NOT_ACTIVE",
  );
  assert.equal(scrapeCalls, 0);
});
