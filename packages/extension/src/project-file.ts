import {
  type ValidationIssue,
  validateProjectDetailed,
} from "./browser-schema.js";

/**
 * Default export name. `rogatio verify` / `edit` / `test` with no path read
 * this file in the current directory.
 */
export const DEFAULT_EXPORT_FILENAME = ".rogatio.json";

/** Prefix for a file that parsed but is not a Rogatio project. */
export const PROJECT_IMPORT_ERROR_PREFIX = "not a Rogatio project: ";

export interface SaveFilePickerType {
  readonly description?: string;
  readonly accept: Readonly<Record<string, readonly string[]>>;
}

export interface SaveFilePickerOptions {
  readonly suggestedName?: string;
  readonly types?: readonly SaveFilePickerType[];
  readonly excludeAcceptAllOption?: boolean;
}

export interface FileSystemWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface FileSystemFileHandleLike {
  readonly name?: string;
  createWritable(): Promise<FileSystemWritable>;
}

export type ShowSaveFilePicker = (
  options?: SaveFilePickerOptions,
) => Promise<FileSystemFileHandleLike>;

export type ExportSaveResult =
  | { readonly status: "saved"; readonly filename: string }
  | { readonly status: "downloaded"; readonly filename: string }
  | { readonly status: "cancelled" };

export interface ExportSaveOptions {
  readonly contents: string;
  readonly suggestedName?: string;
  readonly showSaveFilePicker?: ShowSaveFilePicker;
  readonly promptFilename?: (suggested: string) => string | null;
  readonly download?: (contents: string, filename: string) => void;
}

/**
 * Reason string for a value that is not a Rogatio project, or null when it is.
 * The filename is irrelevant; callers decide by content.
 */
export function projectImportFailure(data: unknown): string | null {
  const result = validateProjectDetailed(data);
  if (result.valid) return null;
  return `${PROJECT_IMPORT_ERROR_PREFIX}${schemaReason(result.errors)}`;
}

/**
 * Download / prompt filename. Does not force `.rogatio` into the name.
 * Appends `.json` only when the typed name has no extension. A directory
 * prefix is dropped because a download can only carry a filename.
 */
export function normalizeExportFilename(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return DEFAULT_EXPORT_FILENAME;
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const filename = (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).trim();
  if (filename.length === 0 || filename === "." || filename === "..") {
    return DEFAULT_EXPORT_FILENAME;
  }
  if (extensionOf(filename) !== null) return filename;
  const stem = filename.replace(/\.+$/u, "");
  if (stem.length === 0) return DEFAULT_EXPORT_FILENAME;
  return `${stem}.json`;
}

/**
 * Write an exported project. Prefers the File System Access save dialog,
 * suggested as `.rogatio.json` with a JSON type and all-files still allowed.
 * When that dialog is missing or fails (other than the user cancelling),
 * falls back to a download under a name the caller collected from the user.
 */
export async function saveExportedProject(
  options: ExportSaveOptions,
): Promise<ExportSaveResult> {
  const suggested = options.suggestedName ?? DEFAULT_EXPORT_FILENAME;
  const picker = options.showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: suggested,
        excludeAcceptAllOption: false,
        types: [
          {
            description: "JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(options.contents);
      await writable.close();
      const filename =
        typeof handle.name === "string" && handle.name.length > 0
          ? handle.name
          : suggested;
      return { status: "saved", filename };
    } catch (error) {
      if (isAbortError(error)) return { status: "cancelled" };
    }
  }

  const prompt = options.promptFilename;
  if (!prompt) {
    options.download?.(options.contents, suggested);
    return { status: "downloaded", filename: suggested };
  }
  const chosen = prompt(suggested);
  if (chosen === null) return { status: "cancelled" };
  const filename = normalizeExportFilename(chosen);
  options.download?.(options.contents, filename);
  return { status: "downloaded", filename };
}

function schemaReason(errors: readonly ValidationIssue[]): string {
  const first = errors[0];
  if (!first) return "invalid project";
  if (first.message.length > 0 && first.message !== "invalid project data") {
    return first.message;
  }
  if (first.instancePath.length > 0) {
    return `${first.keyword} (${first.instancePath})`;
  }
  return first.keyword;
}

/** A leading-dot name such as `.rogatio` has no extension. */
function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = filename.slice(dot + 1);
  if (extension.length === 0) return null;
  return extension;
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!Object.hasOwn(error, "name")) return false;
  return (error as { name: unknown }).name === "AbortError";
}
