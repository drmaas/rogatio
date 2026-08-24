export const DEFAULT_MOCK_PORT = 8890;

export interface MockRuntimeConnection {
  readonly protocol: string;
  readonly port: number;
  readonly presetDigest: string;
  readonly mocks: readonly {
    readonly ruleId: string;
    readonly token: string;
  }[];
}

/**
 * In-memory holder for the last Check-and-connect result. The service worker
 * stores the connection here; the DNR installer's mock-URL resolver reads it to
 * translate mock operations into redirect rules targeting the mock runtime.
 * The holder resets to `null` on service-worker restart (status = last check).
 */
export function createMockConnectionHolder() {
  let connection: MockRuntimeConnection | null = null;
  return {
    set(value: MockRuntimeConnection | null): void {
      connection = value;
    },
    get(): MockRuntimeConnection | null {
      return connection;
    },
    mockUrl(ruleId: string): string | null {
      if (connection === null) return null;
      const token = connection.mocks.find(
        (mock) => mock.ruleId === ruleId,
      )?.token;
      if (token === undefined) return null;
      return `http://127.0.0.1:${connection.port}/mock/${token}`;
    },
  };
}

export type MockConnectionHolder = ReturnType<
  typeof createMockConnectionHolder
>;

/**
 * Fetches the runtime's connection info over loopback, or null when the runtime
 * is unreachable or the response is malformed. The mock tokens are never logged.
 */
export async function fetchMockConnection(
  port: number,
  fetchImpl: typeof fetch = fetch,
): Promise<MockRuntimeConnection | null> {
  let response: Response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${port}/v1/connection`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>).protocol !== "string" ||
    typeof (parsed as Record<string, unknown>).port !== "number" ||
    typeof (parsed as Record<string, unknown>).presetDigest !== "string"
  ) {
    return null;
  }
  const mocks = (parsed as Record<string, unknown>).mocks;
  if (!Array.isArray(mocks)) return null;
  const normalizedMocks: { ruleId: string; token: string }[] = [];
  for (const mock of mocks) {
    if (
      mock === null ||
      typeof mock !== "object" ||
      Array.isArray(mock) ||
      typeof (mock as Record<string, unknown>).ruleId !== "string" ||
      typeof (mock as Record<string, unknown>).token !== "string"
    ) {
      return null;
    }
    normalizedMocks.push({
      ruleId: (mock as Record<string, unknown>).ruleId as string,
      token: (mock as Record<string, unknown>).token as string,
    });
  }
  return {
    protocol: (parsed as Record<string, unknown>).protocol as string,
    port: (parsed as Record<string, unknown>).port as number,
    presetDigest: (parsed as Record<string, unknown>).presetDigest as string,
    mocks: normalizedMocks,
  };
}
