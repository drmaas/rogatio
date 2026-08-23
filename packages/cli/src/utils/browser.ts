import { spawn } from "node:child_process";

export class BrowserLaunchError extends Error {
  readonly platform: string;

  constructor(platform: string, message: string) {
    super(message);
    this.name = "BrowserLaunchError";
    this.platform = platform;
  }
}

export async function launchBrowser(url: string): Promise<boolean> {
  const platform = process.platform;
  let command: string;
  let args: string[];

  switch (platform) {
    case "darwin":
      command = "open";
      args = [url];
      break;
    case "win32":
      command = "cmd";
      args = ["/c", "start", "", url];
      break;
    case "linux":
    case "freebsd":
    case "openbsd":
    case "sunos":
      command = "xdg-open";
      args = [url];
      break;
    default:
      throw new BrowserLaunchError(
        platform,
        `Unsupported platform: ${platform}`,
      );
  }

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });

    child.unref();

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}
