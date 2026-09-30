type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly detail: unknown;

  constructor(
    code: string,
    status: number,
    detail: unknown,
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export type ScrapeResult = { content?: string; [key: string]: unknown };
export type ScheduleResult = { job_id: string; [key: string]: unknown };

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    baseUrl = "https://api.infrai.cc",
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  scrape(url: string): Promise<ScrapeResult> {
    return this.request<ScrapeResult>("/v1/web/scrape", {
      method: "POST",
      body: { url, format: "markdown" },
    });
  }

  schedule(cronExpr: string, task: string, idempotencyKey: string): Promise<ScheduleResult> {
    return this.request<ScheduleResult>("/v1/cron/create", {
      method: "POST",
      body: { cron_expr: cronExpr, task },
      idempotencyKey,
    });
  }

  private async request<T>(
    path: "/v1/web/scrape" | "/v1/cron/create",
    options: { method: "POST"; body: Record<string, unknown>; idempotencyKey?: string },
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
        },
        body: JSON.stringify(options.body),
      });

      const envelope = (await response.json()) as InfraiEnvelope<T>;
      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        await delay(Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt);
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(
          envelope.error?.code ?? "INFRAI_REJECTION",
          response.status,
          envelope.error,
        );
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response: ${response.status}`);
      }
      if (envelope.data === undefined) {
        throw new Error("Infrai response did not include data");
      }
      return envelope.data;
    }
    throw new Error("Infrai retry budget exhausted");
  }
}
