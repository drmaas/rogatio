import { randomInt } from "node:crypto";
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

      const maxRetries = 8;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const candidatePort = randomInt(1024, 65535);

        try {
          await listenOn(candidatePort);
          port = candidatePort;
          started = true;
          return;
        } catch (e) {
          lastError = e as Error;
          const code = (e as NodeJS.ErrnoException).code;
          // Windows reserves chunks of the dynamic port range (Hyper-V / WSL
          // excluded port ranges), so a random candidate can fail to bind
          // with EACCES just like a busy port fails with EADDRINUSE. Both are
          // environmental and resolved by trying another random port.
          if (code !== "EADDRINUSE" && code !== "EACCES") {
            throw new HttpServerError(
              "listen-failed",
              `Failed to start server: ${e}`,
              e as Error,
            );
          }
          // Port in use or reserved, retry with a different random port
        }
      }

      throw new HttpServerError(
        "port-exhausted",
        `Failed to bind to port after ${maxRetries} attempts`,
        lastError ?? undefined,
      );
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
