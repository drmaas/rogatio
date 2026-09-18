/**
 * Minimal CDP client over Chrome's remote-debugging WebSocket.
 * Chromedriver's sendDevToolsCommand is request/response only; ServiceWorker
 * stop needs event subscriptions (workerVersionUpdated).
 */
import type { WebDriver } from "selenium-webdriver";

type JsonRpcRequest = {
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

export type CdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: unknown) => void): void;
  off(event: string, handler: (params: unknown) => void): void;
  close(): Promise<void>;
};

function debuggerAddress(driver: WebDriver): Promise<string> {
  return driver.getCapabilities().then((caps) => {
    const options = caps.get("goog:chromeOptions") as
      | { debuggerAddress?: string }
      | undefined;
    const address = options?.debuggerAddress;
    if (!address) {
      throw new Error(
        "Chrome debuggerAddress missing; cannot open CDP WebSocket session",
      );
    }
    return address;
  });
}

export async function openPageCdpSession(
  driver: WebDriver,
): Promise<CdpSession> {
  const address = await debuggerAddress(driver);
  const targets = (await fetch(`http://${address}/json/list`).then((r) =>
    r.json(),
  )) as Array<{
    type?: string;
    url?: string;
    webSocketDebuggerUrl?: string;
  }>;
  const currentUrl = await driver.getCurrentUrl();
  const pageTargets = targets.filter(
    (t) => t.type === "page" && typeof t.webSocketDebuggerUrl === "string",
  );
  const pageTarget =
    pageTargets.find((t) => t.url === currentUrl) ??
    pageTargets.find(
      (t) =>
        typeof t.url === "string" &&
        currentUrl.startsWith("chrome-extension://") &&
        t.url.startsWith("chrome-extension://"),
    ) ??
    pageTargets.find(
      (t) =>
        typeof t.url === "string" &&
        (currentUrl.startsWith(t.url) || t.url.startsWith(currentUrl)),
    ) ??
    pageTargets[0];
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error("No page CDP target with webSocketDebuggerUrl");
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("CDP WebSocket connect timeout")),
      10_000,
    );
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP WebSocket error"));
    });
  });

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const listeners = new Map<string, Set<(params: unknown) => void>>();

  ws.addEventListener("message", (event) => {
    const raw =
      typeof event.data === "string" ? event.data : String(event.data);
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(raw) as JsonRpcResponse;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(message.error.message ?? "CDP error"));
      } else {
        waiter.resolve(message.result);
      }
      return;
    }
    if (message.method) {
      const handlers = listeners.get(message.method);
      if (!handlers) return;
      for (const handler of handlers) handler(message.params);
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      const payload: JsonRpcRequest = { id, method, params };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(payload));
      });
    },
    on(event, handler) {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
    },
    async close() {
      for (const waiter of pending.values()) {
        waiter.reject(new Error("CDP session closed"));
      }
      pending.clear();
      listeners.clear();
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    },
  };
}
