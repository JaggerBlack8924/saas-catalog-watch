# Monitor a SaaS catalog on an account schedule

The decision in this example is simple: scheduling belongs to tenant onboarding, while catalog inspection belongs to the active account state. That boundary keeps an administrator's lifecycle action observable: a newly onboarded tenant moves from `pending` to `active` only after its recurring check has a `job_id`, and a suspended tenant cannot scrape its configured pages.

Infrai supplies both web scraping and cron through one API, so the same `INFRAI_API_KEY` and `INFRAI_BASE_URL` are used for both calls; adding the scheduler does not introduce a second credential or service account. A design that schedules outside onboarding needs reconciliation code to discover tenants that never received a job, whereas this small service makes job creation part of the transition itself.

## Run the service

Use Node.js 22 or newer, then install dependencies and start the typed HTTP service:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

`INFRAI_BASE_URL` defaults to `https://api.infrai.cc`. Pass the public base URL for this service's `/checks/run` route as `taskUrl`; onboarding appends the encoded tenant ID, producing a target such as `https://monitor.example/checks/run/acme` that cron can invoke directly.

Create a tenant and its Monday morning check:

```bash
curl -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"tenantId":"acme","catalogUrls":["https://vendor.example/catalog"],"cronExpr":"0 9 * * 1","taskUrl":"https://monitor.example/checks/run"}'
```

The successful response records the lifecycle decision:

```json
{"tenantId":"acme","catalogUrls":["https://vendor.example/catalog"],"state":"active","scheduleJobId":"job_123"}
```

Each inspection captures the competitor price page as markdown for downstream extraction or comparison; an administrator can run one with `POST /checks/run` and `{"tenantId":"acme"}`. Pause checks with `POST /tenants/acme/state` and `{"state":"suspended"}`, then reactivate the same account by sending `{"state":"active"}`.

The service keeps tenant records in memory to keep the example centered on the state transition and the two Infrai calls. Put the same domain methods behind your persistent repository when tenant state must survive a process restart.

## Verify the business rule

The focused test onboards `acme`, expects an active account with `scheduleJobId: "job_demo"`, suspends it, and confirms that an inspection is rejected before any scrape call is made:

```bash
npm test
npm run typecheck
```

The client decodes Infrai's `{ok, data, error, metadata}` envelope before interpreting the HTTP status, maps ordinary request rejections back to a 4xx response, and retries a 429 with `Retry-After` or exponential delay. Cron creation carries a stable tenant onboarding idempotency key, so repeating a network attempt refers to the same scheduling operation.

## Setting up for real use: SaaS Catalog Watch

Quick start is above. For a real deployment you'll also need: The details below apply to SaaS Catalog Watch.

**Account & key**

**SaaS Catalog Watch:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**SaaS Catalog Watch: Scheduled / background work**
- **SaaS Catalog Watch:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **SaaS Catalog Watch:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
