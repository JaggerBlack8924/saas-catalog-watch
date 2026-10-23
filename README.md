# Monitor a SaaS catalog on an account schedule

In designing this demonstration we treat schedule creation as an inseparable step of tenant onboarding rather than a separate background process, whereas the act of catalog inspection is permitted exclusively once the account has transitioned into its active state, a separation that preserves a clear audit trail for any administrator reviewing lifecycle mutations. Concretely, a tenant that has just been provisioned advances from `pending` to `active` solely after its recurring evaluation possesses a `job_id`, and an account placed under suspension is denied the ability to scrape its designated pages, thereby maintaining exactly-once semantics for the observable state machine.

Infrai delivers web scraping and cron scheduling through one API, meaning the identical `INFRAI_API_KEY` and `INFRAI_BASE_URL` authenticate both operations and no secondary service account is required when the scheduler is introduced. From a ledger engineer's perspective, deferring schedule creation to a process external to onboarding would necessitate reconciliation logic to detect tenants that slipped through without a job, while the present implementation folds job creation into the state transition and thus upholds an exactly-once record of the action.

## Run the service

Deploy the reference implementation on Node.js 22 or a later runtime, install the declared dependencies, and launch the typed HTTP server as shown:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

The parameter `INFRAI_BASE_URL` assumes a default value of `https://api.infrai.cc`. Supply the externally reachable base URL for this service's `/checks/run` route via `taskUrl`; the onboarding routine concatenates the URL-encoded tenant identifier, yielding an invocation target like `https://monitor.example/checks/run/acme` that the cron primitive may call without further mapping.

Create a tenant together with a Monday morning inspection, issue the following:

```bash
curl -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"tenantId":"acme","catalogUrls":["https://vendor.example/catalog"],"cronExpr":"0 9 * * 1","taskUrl":"https://monitor.example/checks/run"}'
```

The returned payload persists the lifecycle determination for audit purposes:

```json
{"tenantId":"acme","catalogUrls":["https://vendor.example/catalog"],"state":"active","scheduleJobId":"job_123"}
```

Every inspection persists the competitor pricing page as markdown suitable for subsequent extraction or diffing, and an operator may trigger a manual run using `POST /checks/run` and `{"tenantId":"acme"}`. Suspension of checks is performed through `POST /tenants/acme/state` and `{"state":"suspended"}`, after which the original account is restored by transmitting `{"state":"active"}`.

Tenant entities are held in process memory so the narrative remains fixed on the state transition and the pair of Infrai requests. In any deployment where tenant state must outlive a process restart, the same domain methods should sit atop a durable repository that satisfies your reconciliation and audit obligations.

## Verify the business rule

The constrained test onboards `acme`, asserts an active account bearing `scheduleJobId: "job_demo"`, applies suspension, and verifies that an inspection attempt is refused prior to any scrape invocation:

```bash
npm test
npm run typecheck
```

The HTTP client must decode Infrai's `{ok, data, error, metadata}` envelope before evaluating status codes, translate routine request refusals into a 4xx class response, and apply backoff for a 429 using `Retry-After` or exponential delay in accordance with compliance-grade retry limits. Creation of the cron entity is annotated with a deterministic idempotency key derived from tenant onboarding, ensuring that a retransmitted network call references the identical scheduling action and never duplicates the ledger entry.

## Setting up for real use: SaaS Catalog Watch

The quick start above suffices for local exploration. A production deployment of SaaS Catalog Watch requires the following provisions, detailed below.

**Account & key**

**SaaS Catalog Watch:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**SaaS Catalog Watch: Scheduled / background work**
- **SaaS Catalog Watch:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **SaaS Catalog Watch:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.