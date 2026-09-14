import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export class HttpServerError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: Error) {
    super(message, { cause });
    this.name = "HttpServerError";
    this.code = code;
  }
}

export interface HttpServer {
  port: number;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CreateServerOptions {
  /** Fixed port to bind. When omitted, an ephemeral port is chosen. */
  port?: number;
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

export function createServer(
  handler: RequestHandler,
  options: CreateServerOptions = {},
): HttpServer {
  const server = createHttpServer(handler);
  const preferredPort = options.port;
  let port: number | null = null;
  let started = false;

  async function listenOn(candidatePort: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(candidatePort, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  }

  function boundPort(): number {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new HttpServerError(
        "listen-failed",
        "Failed to resolve bound port after listen",
      );
    }
    return address.port;
  }

  return {
    get port() {
      if (port === null)
        throw new HttpServerError("not-started", "Server not started");
      return port;
    },

    async start(): Promise<void> {
      if (started) return;

      if (preferredPort !== undefined) {
        try {
          await listenOn(preferredPort);
          port = preferredPort;
          started = true;
          return;
        } catch (e) {
          throw new HttpServerError(
            "listen-failed",
            `Failed to start server on port ${preferredPort}: ${e}`,
            e as Error,
          );
        }
      }

      // Use OS ephemeral assignment (port 0). Random high ports can land on
      // WHATWG/undici blocked ports (e.g. 6000), which Node accepts but fetch()
      // rejects with "bad port".
      try {
        await listenOn(0);
        port = boundPort();
        started = true;
      } catch (e) {
        if (e instanceof HttpServerError) throw e;
        throw new HttpServerError(
          "listen-failed",
          `Failed to start server: ${e}`,
          e as Error,
        );
      }
    },

    async stop(): Promise<void> {
      if (!started) return;

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      started = false;
    },
  };
}
