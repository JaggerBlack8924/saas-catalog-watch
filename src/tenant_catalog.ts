import type { InfraiClient, ScrapeResult } from "./infrai_client.js";

export type AccountState = "pending" | "active" | "suspended";

export type TenantAccount = {
  tenantId: string;
  catalogUrls: string[];
  state: AccountState;
  scheduleJobId?: string;
};

export class TenantCatalogService {
  private readonly accounts = new Map<string, TenantAccount>();
  private readonly infrai: Pick<InfraiClient, "scrape" | "schedule">;

  constructor(infrai: Pick<InfraiClient, "scrape" | "schedule">) {
    this.infrai = infrai;
  }

  async onboard(input: {
    tenantId: string;
    catalogUrls: string[];
    cronExpr: string;
    taskUrl: string;
  }): Promise<TenantAccount> {
    if (this.accounts.has(input.tenantId)) {
      throw new DomainError("TENANT_EXISTS", 409);
    }
    const account: TenantAccount = {
      tenantId: input.tenantId,
      catalogUrls: input.catalogUrls,
      state: "pending",
    };
    this.accounts.set(input.tenantId, account);

    const scheduled = await this.infrai.schedule(
      input.cronExpr,
      `${input.taskUrl.replace(/\/$/, "")}/${encodeURIComponent(input.tenantId)}`,
      `tenant-onboarding:${input.tenantId}`,
    );
    account.scheduleJobId = scheduled.job_id;
    account.state = "active";
    return { ...account };
  }

  setState(tenantId: string, state: Exclude<AccountState, "pending">): TenantAccount {
    const account = this.requireAccount(tenantId);
    account.state = state;
    return { ...account };
  }

  async inspectCatalog(tenantId: string): Promise<Array<{ url: string; snapshot: ScrapeResult }>> {
    const account = this.requireAccount(tenantId);
    if (account.state !== "active") {
      throw new DomainError("ACCOUNT_NOT_ACTIVE", 409);
    }
    return Promise.all(
      account.catalogUrls.map(async (url) => ({ url, snapshot: await this.infrai.scrape(url) })),
    );
  }

  private requireAccount(tenantId: string): TenantAccount {
    const account = this.accounts.get(tenantId);
    if (!account) throw new DomainError("TENANT_NOT_FOUND", 404);
    return account;
  }
}

export class DomainError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
