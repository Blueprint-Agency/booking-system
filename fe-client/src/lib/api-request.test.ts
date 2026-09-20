import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendApiRequest, type ErrorReporter } from "./api-request.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Reported = { error: unknown; context: Record<string, unknown> | undefined };

function recorder(): { report: ErrorReporter; reported: Reported[] } {
  const reported: Reported[] = [];
  return { reported, report: (error, context) => reported.push({ error, context }) };
}

/**
 * A backend that never answers, but gives up when the request is aborted — as
 * `fetch` does. It holds the event loop open while it hangs, as a real socket
 * would: `AbortSignal.timeout`'s timer does not, and the test would end first.
 */
function hangingFetch(): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const socket = setInterval(() => {}, 1_000);
      init?.signal?.addEventListener("abort", () => {
        clearInterval(socket);
        reject(init.signal!.reason);
      });
    })) as typeof fetch;
}

test("a request the backend never answers rejects at the deadline and is reported", async () => {
  globalThis.fetch = hangingFetch();
  const { report, reported } = recorder();

  await assert.rejects(
    sendApiRequest("http://api.test/x", { method: "GET" }, { report, label: "Client API", timeoutMs: 20 }),
    (err: unknown) => err instanceof Error && err.name === "TimeoutError",
  );
  assert.equal(reported.length, 1);
  assert.equal(reported[0]!.context?.scope, "api-fetch-network");
  assert.equal(reported[0]!.context?.errorType, "TimeoutError");
  assert.equal(reported[0]!.context?.method, "GET");
});

test("a 5xx is reported with its status and the backend's requestId", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "internal_error", requestId: "req-123" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  const { report, reported } = recorder();

  const result = await sendApiRequest("http://api.test/x", { method: "POST" }, { report, label: "Client API" });

  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: "internal_error", requestId: "req-123" });
  assert.equal(reported.length, 1);
  assert.equal(reported[0]!.context?.scope, "api-fetch-5xx");
  assert.equal(reported[0]!.context?.status, 500);
  assert.equal(reported[0]!.context?.requestId, "req-123");
  assert.equal(reported[0]!.context?.method, "POST");
});

test("a 5xx without a JSON body is still reported, with no requestId", async () => {
  globalThis.fetch = (async () => new Response("Bad Gateway", { status: 502 })) as typeof fetch;
  const { report, reported } = recorder();

  const result = await sendApiRequest("http://api.test/x", {}, { report, label: "Client API" });

  assert.equal(result.body, "Bad Gateway");
  assert.equal(reported[0]!.context?.status, 502);
  assert.equal(reported[0]!.context?.requestId, undefined);
});

test("a 4xx is the caller's to handle, not reported", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "nope" }), { status: 409 })) as typeof fetch;
  const { report, reported } = recorder();

  const result = await sendApiRequest("http://api.test/x", {}, { report, label: "Client API" });

  assert.equal(result.ok, false);
  assert.equal(reported.length, 0);
});

test("a caller-supplied signal wins over the default deadline", async () => {
  globalThis.fetch = hangingFetch();
  const { report } = recorder();
  const controller = new AbortController();

  // The deadline is shorter than the caller's abort, but the caller's signal is the one in force:
  // the request is still pending when the deadline would have fired, and ends on the caller's abort.
  const pending = sendApiRequest(
    "http://api.test/x",
    { signal: controller.signal },
    { report, label: "Client API", timeoutMs: 10 },
  );
  await new Promise((r) => setTimeout(r, 40));
  controller.abort();

  await assert.rejects(pending, (err: unknown) => err instanceof Error && err.name === "AbortError");
});

test("a caller's own abort is not reported as a failure", async () => {
  globalThis.fetch = hangingFetch();
  const { report, reported } = recorder();
  const controller = new AbortController();

  const pending = sendApiRequest("http://api.test/x", { signal: controller.signal }, { report, label: "Client API" });
  controller.abort();

  await assert.rejects(pending);
  assert.equal(reported.length, 0);
});
