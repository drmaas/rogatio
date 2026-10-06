import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type InterceptProxyHandle,
  startInterceptProxy,
} from "../src/intercept-proxy.js";
import { createNativeRuntimeController } from "../src/lifecycle.js";
import { RUNTIME_LIMITS } from "../src/limits.js";
import type { RenderedMock } from "../src/mock.js";
import {
  MOCK_LISTENER_PREFIX,
  parseMockRedirect,
} from "../src/mock-listener.js";
import { isConfinedFileSupported } from "../src/platform-file.js";
import { ENVELOPE_MAX_BYTES, type RuntimeResult } from "../src/types.js";

const directories: string[] = [];
const proxies: InterceptProxyHandle[] = [];

afterEach(async () => {
  for (const proxy of proxies.splice(0)) await proxy.stop();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function mockPath(token: string, digest: string): string {
  return `${MOCK_LISTENER_PREFIX}${encodeURIComponent(token)}/${encodeURIComponent(digest)}`;
}

async function hit(
  port: number,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Uint8Array; contentLength: string | null }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return {
    status: response.status,
    body: new Uint8Array(await response.arrayBuffer()),
    contentLength: response.headers.get("content-length"),
  };
}

const source = {
  key: "url" as const,
  operator: "regex" as const,
  value: "^https://example\\.com/",
};

function project(mock: Record<string, unknown>, method?: string) {
  return {
    version: 2,
    name: "mocks",
    groups: [
      {
        id: "g1",
        name: "G",
        rules: [
          {
            id: "r1",
            name: "Mock",
            source,
            resourceTypes: ["main_frame"],
            priority: 1,
            ...(method !== undefined ? { method } : {}),
            type: "mock",
            mock,
          },
        ],
      },
    ],
  };
}

async function boot(
  mock: Record<string, unknown>,
  extras?: { readonly method?: string; readonly fileRoot?: string },
) {
  const controller = createNativeRuntimeController({});
  const set = await controller.handleEnvelope({
    type: "runtime.project.set",
    metadata: {
      project: project(mock, extras?.method),
      ...(extras?.fileRoot !== undefined ? { fileRoot: extras.fileRoot } : {}),
    },
  });
  const digest = String(set.metadata.presetDigest);
  const connect = await controller.handleEnvelope({
    type: "mock.connect",
    metadata: {},
  });
  const issued =
    (
      connect.metadata as {
        mocks?: readonly { ruleId: string; token: string }[];
      }
    ).mocks ?? [];
  const policy = controller.getActivePolicy();
  const proxy = await startInterceptProxy({
    policy: {
      project: policy?.project,
      operations: policy?.operations ?? [],
      presetDigest: digest,
    },
    serveMock: (request) =>
      controller.serveMock(request.token, {
        method: request.method,
        signal: request.signal,
      }),
  });
  proxies.push(proxy);
  return { controller, proxy, digest, token: issued[0]?.token ?? "" };
}

describe("mock listener URLs", () => {
  it("parses a token and digest and rejects hostile routes", () => {
    expect(MOCK_LISTENER_PREFIX).toBe("/.rogatio/mock/");
    expect(parseMockRedirect("/.rogatio/mock/abc/sha256%3Adef")).toEqual({
      token: "abc",
      digest: "sha256:def",
    });
    expect(parseMockRedirect("/.rogatio/mock/abc/sha256%3Adef?x=1")).toEqual({
      token: "abc",
      digest: "sha256:def",
    });
    for (const raw of [
      "/.rogatio/mock/../secret",
      "/.rogatio/mock/%2e%2e/%2e%2e",
      "/.rogatio/mock/token",
      "/.rogatio/mock/token/digest/extra",
      "/.rogatio/mock//digest",
      "/.rogatio/mock/tok%00en/digest",
      "/.rogatio/mock/tok%0den/digest",
      "/.rogatio/mock/tok%0aen/digest",
      "/.rogatio/mock/tok%7fen/digest",
      "/.rogatio/body/rule/digest/https://example.com/",
    ]) {
      expect(parseMockRedirect(raw)).toBeNull();
    }
  });
});

describe("loopback mock route", () => {
  it("serves the active token and rejects rule ids, bad digests, and unknown tokens", async () => {
    const { proxy, digest, token } = await boot({ status: 200, body: "hello" });
    const ok = await hit(proxy.endpoint.port, mockPath(token, digest));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(new TextEncoder().encode("hello"));

    const byRule = await hit(proxy.endpoint.port, mockPath("r1", digest));
    expect(byRule.status).toBe(404);
    expect(byRule.body).toEqual(new Uint8Array());

    const wrongDigest = await hit(
      proxy.endpoint.port,
      mockPath(
        token,
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      ),
    );
    expect(wrongDigest.status).toBe(403);
    expect(wrongDigest.body).toEqual(new Uint8Array());

    const missing = await hit(
      proxy.endpoint.port,
      mockPath("deadbeef", digest),
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(new Uint8Array());
  });

  it("rejects a stopped session and a token from the previous start", async () => {
    const { controller, proxy, digest, token } = await boot({
      status: 200,
      body: "hello",
    });
    proxy.setPolicy(null);
    const stopped = await hit(proxy.endpoint.port, mockPath(token, digest));
    expect(stopped.status).toBe(403);
    expect(stopped.body).toEqual(new Uint8Array());

    proxy.setPolicy({
      project: controller.getActivePolicy()?.project,
      operations: controller.getActivePolicy()?.operations ?? [],
      presetDigest: digest,
    });
    await controller.stop();
    await controller.start();
    const expired = await hit(proxy.endpoint.port, mockPath(token, digest));
    expect(expired.status).toBe(404);
    expect(expired.body).toEqual(new Uint8Array());

    const connect = await controller.handleEnvelope({
      type: "mock.connect",
      metadata: {},
    });
    const next = (connect.metadata as { mocks: readonly { token: string }[] })
      .mocks[0]?.token;
    const again = await hit(proxy.endpoint.port, mockPath(next ?? "", digest));
    expect(again.status).toBe(200);
    expect(again.body).toEqual(new TextEncoder().encode("hello"));
  });

  it("allows the rule method and rejects others", async () => {
    const { proxy, digest, token } = await boot(
      { status: 201, body: "hello" },
      { method: "GET" },
    );
    const posted = await hit(proxy.endpoint.port, mockPath(token, digest), {
      method: "POST",
    });
    expect(posted.status).toBe(405);
    expect(posted.body).toEqual(new Uint8Array());

    const fetched = await hit(proxy.endpoint.port, mockPath(token, digest));
    expect(fetched.status).toBe(201);
    expect(fetched.body).toEqual(new TextEncoder().encode("hello"));
  });

  it("serves HEAD with the full length and an empty body", async () => {
    const { proxy, digest, token } = await boot({ status: 201, body: "hello" });
    const head = await hit(proxy.endpoint.port, mockPath(token, digest), {
      method: "HEAD",
    });
    expect(head.status).toBe(201);
    expect(head.body).toEqual(new Uint8Array());
    expect(head.contentLength).toBe("5");
  });

  it("serves a binary body larger than one native envelope", async () => {
    if (!isConfinedFileSupported()) return;
    const root = await mkdtemp(join(tmpdir(), "rogatio-mock-route-"));
    directories.push(root);
    const bytes = new Uint8Array(ENVELOPE_MAX_BYTES + 4096);
    bytes[0] = 0xff;
    bytes[bytes.length - 1] = 0x10;
    await writeFile(join(root, "payload.bin"), bytes);
    const { proxy, digest, token } = await boot(
      { status: 200, file: "payload.bin" },
      { fileRoot: root },
    );
    const response = await hit(proxy.endpoint.port, mockPath(token, digest));
    expect(response.status).toBe(200);
    expect(response.body).toEqual(bytes);
    expect(Buffer.from(response.body).toString("utf8")).not.toContain(root);
    expect(Buffer.from(response.body).toString("utf8")).not.toContain(
      "payload.bin",
    );
  });

  it("returns an empty failure and no path when the file cannot be read", async () => {
    const root = await mkdtemp(join(tmpdir(), "rogatio-mock-miss-"));
    directories.push(root);
    const { proxy, digest, token } = await boot(
      { status: 200, file: "missing.bin" },
      { fileRoot: root },
    );
    const response = await hit(proxy.endpoint.port, mockPath(token, digest));
    expect(response.status).toBe(502);
    expect(response.body).toEqual(new Uint8Array());
    expect(response.contentLength).toBe("0");
  });

  it("discards a large request body without changing the mock", async () => {
    const { proxy, digest, token } = await boot({ status: 200, body: "hello" });
    const response = await hit(proxy.endpoint.port, mockPath(token, digest), {
      method: "POST",
      body: Buffer.alloc(256 * 1024, 7),
      headers: { "content-type": "application/octet-stream" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(new TextEncoder().encode("hello"));
  });

  it("cancels a delay when the client disconnects and frees the slot", async () => {
    let inFlight = 0;
    const signals: AbortSignal[] = [];
    const proxy = await startInterceptProxy({
      policy: { project: {}, operations: [], presetDigest: "sha256:abc" },
      serveMock: (request) =>
        new Promise((resolve) => {
          inFlight += 1;
          signals.push(request.signal);
          const finish = () => {
            inFlight -= 1;
            resolve({
              ok: false,
              error: { code: "runtime.timeout" },
            });
          };
          if (request.signal.aborted) finish();
          else request.signal.addEventListener("abort", finish, { once: true });
        }),
    });
    proxies.push(proxy);
    const path = mockPath("token", "sha256:abc");
    const held = Array.from(
      { length: RUNTIME_LIMITS.maxConcurrentOperations },
      () => {
        const abort = new AbortController();
        const pending = hit(proxy.endpoint.port, path, {
          signal: abort.signal,
        }).catch(() => undefined);
        return { abort, pending };
      },
    );
    await vi.waitFor(() => {
      expect(inFlight).toBe(RUNTIME_LIMITS.maxConcurrentOperations);
    });
    held[0]?.abort.abort();
    await vi.waitFor(() => {
      expect(signals[0]?.aborted).toBe(true);
      expect(inFlight).toBe(RUNTIME_LIMITS.maxConcurrentOperations - 1);
    });
    const extraAbort = new AbortController();
    const extra = hit(proxy.endpoint.port, path, { signal: extraAbort.signal });
    await vi.waitFor(() => {
      expect(inFlight).toBe(RUNTIME_LIMITS.maxConcurrentOperations);
    });
    for (const item of held) item.abort.abort();
    extraAbort.abort();
    await Promise.all([
      ...held.map((item) => item.pending.catch(() => undefined)),
      extra.catch(() => undefined),
    ]);
  });

  it("stops the listener without finishing a delayed mock", async () => {
    const { proxy, digest, token } = await boot({
      status: 200,
      body: "hello",
      delayMs: 30_000,
    });
    const pending = fetch(
      `http://127.0.0.1:${proxy.endpoint.port}${mockPath(token, digest)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const index = proxies.indexOf(proxy);
    if (index >= 0) proxies.splice(index, 1);
    const started = Date.now();
    await proxy.stop();
    expect(Date.now() - started).toBeLessThan(2_000);
    const response = await pending.then(
      async (value) => ({
        status: value.status,
        body: new Uint8Array(await value.arrayBuffer()),
      }),
      () => null,
    );
    if (response !== null) {
      expect(response.status).not.toBe(200);
      expect(response.body).toEqual(new Uint8Array());
    }
  });

  it("rejects one more delayed request than the concurrent bound", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    const proxy = await startInterceptProxy({
      policy: { project: {}, operations: [], presetDigest: "sha256:abc" },
      serveMock: () => {
        entered += 1;
        return gate.then(
          (): RuntimeResult<RenderedMock> => ({
            ok: true,
            value: {
              status: 200,
              headers: [["content-length", "1"]],
              bodyBytes: Uint8Array.of(1),
            },
          }),
        );
      },
    });
    proxies.push(proxy);
    const path = mockPath("token", "sha256:abc");
    const held = Array.from(
      { length: RUNTIME_LIMITS.maxConcurrentOperations },
      () => hit(proxy.endpoint.port, path),
    );
    await vi.waitFor(() => {
      expect(entered).toBe(RUNTIME_LIMITS.maxConcurrentOperations);
    });
    const overflow = await hit(proxy.endpoint.port, path);
    expect(overflow.status).toBe(429);
    expect(overflow.body).toEqual(new Uint8Array());
    release();
    const rest = await Promise.all(held);
    expect(rest.every((response) => response.status === 200)).toBe(true);
  });

  it("answers hostile routes with an empty 400", async () => {
    const { proxy } = await boot({ status: 200, body: "hello" });
    const response = await hit(
      proxy.endpoint.port,
      "/.rogatio/mock/%2e%2e/%2e%2e",
    );
    expect(response.status).toBe(400);
    expect(response.body).toEqual(new Uint8Array());
  });
});
