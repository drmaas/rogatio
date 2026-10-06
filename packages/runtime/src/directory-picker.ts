import { type SpawnOptions, spawn } from "node:child_process";

export interface DirectoryDialogCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export type DirectoryPick =
  | { readonly ok: true; readonly path: string | null }
  | { readonly ok: false; readonly code: "runtime.picker-unavailable" };

export interface DialogRunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly errorCode?: string;
}

export type DialogRunner = (
  command: string,
  args: readonly string[],
) => Promise<DialogRunResult>;

const WINDOWS_FOLDER_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.Description = 'Mock files folder'",
  "if ($dialog.ShowDialog() -eq 'OK') { $dialog.SelectedPath }",
].join("; ");

/** OS folder dialogs that return a filesystem path. Empty when none exist. */
export function directoryDialogCommands(
  platform: NodeJS.Platform = process.platform,
): readonly DirectoryDialogCommand[] {
  if (platform === "darwin") {
    return [
      {
        command: "osascript",
        args: [
          "-e",
          'POSIX path of (choose folder with prompt "Choose the mock files folder")',
        ],
      },
    ];
  }
  if (platform === "win32") {
    return [
      {
        command: "powershell.exe",
        args: ["-NoProfile", "-STA", "-Command", WINDOWS_FOLDER_SCRIPT],
      },
    ];
  }
  if (platform === "linux") {
    return [
      {
        command: "zenity",
        args: ["--file-selection", "--directory", "--title=Mock files folder"],
      },
      {
        command: "kdialog",
        args: ["--getexistingdirectory", "--title", "Mock files folder"],
      },
    ];
  }
  return [];
}

const MAX_PICK_STDOUT = 4096;

function runDialog(
  command: string,
  args: readonly string[],
): Promise<DialogRunResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: DialogRunResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const options: SpawnOptions = {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: false,
    };
    const child = spawn(command, [...args], options);
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout?.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_PICK_STDOUT) chunks.push(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({ code: null, stdout: "", errorCode: error.code });
    });
    child.on("close", (code) => {
      finish({
        code,
        stdout: Buffer.concat(chunks).toString("utf8"),
        ...(size > MAX_PICK_STDOUT ? { errorCode: "too-large" } : {}),
      });
    });
  });
}

/**
 * Open a system folder dialog and return the chosen path.
 * `path: null` means the user cancelled. No dialog tool means unavailable.
 */
export async function pickDirectory(
  run: DialogRunner = runDialog,
  platform: NodeJS.Platform = process.platform,
): Promise<DirectoryPick> {
  const commands = directoryDialogCommands(platform);
  if (commands.length === 0) {
    return { ok: false, code: "runtime.picker-unavailable" };
  }
  for (const dialog of commands) {
    const result = await run(dialog.command, dialog.args);
    if (result.errorCode === "ENOENT") continue;
    if (result.errorCode !== undefined) {
      return { ok: false, code: "runtime.picker-unavailable" };
    }
    if (result.code === 0) {
      const path = result.stdout.trim();
      return { ok: true, path: path.length === 0 ? null : path };
    }
    if (result.code === 1) return { ok: true, path: null };
    return { ok: false, code: "runtime.picker-unavailable" };
  }
  return { ok: false, code: "runtime.picker-unavailable" };
}
