import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPORT_FILENAME,
  type ExportSaveOptions,
  type FileSystemFileHandleLike,
  normalizeExportFilename,
  projectImportFailure,
  type SaveFilePickerOptions,
  saveExportedProject,
} from "../src/project-file.js";

const validProject = {
  version: 2,
  name: "Imported",
  groups: [],
};

describe("projectImportFailure", () => {
  it("accepts a valid project regardless of the filename the caller used", () => {
    expect(projectImportFailure(validProject)).toBeNull();
  });

  it("reports the schema reason for a non-project JSON value", () => {
    expect(projectImportFailure({ hello: "world" })).toBe(
      "not a Rogatio project: unknown-property",
    );
    expect(projectImportFailure({ version: 2 })).toBe(
      "not a Rogatio project: invalid-value (/name)",
    );
  });

  it("rejects objects that only inherit project fields", () => {
    const inherited = Object.create({
      version: 2,
      name: "Hidden",
      groups: [],
    }) as Record<string, unknown>;
    expect(projectImportFailure(inherited)).toMatch(/^not a Rogatio project:/);
  });
});

describe("normalizeExportFilename", () => {
  it("defaults an empty name to .rogatio.json", () => {
    expect(normalizeExportFilename("")).toBe(DEFAULT_EXPORT_FILENAME);
    expect(normalizeExportFilename("   ")).toBe(DEFAULT_EXPORT_FILENAME);
  });

  it("keeps a typed extension and appends .json only when one is missing", () => {
    expect(normalizeExportFilename(".rogatio.json")).toBe(".rogatio.json");
    expect(normalizeExportFilename("staging.json")).toBe("staging.json");
    expect(normalizeExportFilename("staging")).toBe("staging.json");
    expect(normalizeExportFilename(".rogatio")).toBe(".rogatio.json");
    expect(normalizeExportFilename("notes.txt")).toBe("notes.txt");
  });

  it("uses the filename when the user types a directory prefix", () => {
    expect(normalizeExportFilename("mocks/checkout.json")).toBe(
      "checkout.json",
    );
    expect(normalizeExportFilename("mocks/checkout")).toBe("checkout.json");
  });
});

describe("saveExportedProject", () => {
  it("opens the save dialog prefilled with .rogatio.json", async () => {
    const calls: SaveFilePickerOptions[] = [];
    let written = "";
    const picker = async (
      options?: SaveFilePickerOptions,
    ): Promise<FileSystemFileHandleLike> => {
      calls.push(options ?? {});
      return {
        name: "checkout.json",
        async createWritable() {
          return {
            async write(data: string) {
              written = data;
            },
            async close() {
              return undefined;
            },
          };
        },
      };
    };

    const result = await saveExportedProject({
      contents: '{"version":2}\n',
      showSaveFilePicker: picker,
    });

    expect(result).toEqual({ status: "saved", filename: "checkout.json" });
    expect(written).toBe('{"version":2}\n');
    expect(calls).toEqual([
      {
        suggestedName: ".rogatio.json",
        excludeAcceptAllOption: false,
        types: [
          {
            description: "JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      },
    ]);
  });

  it("does not fall back when the user cancels the save dialog", async () => {
    const downloads: string[] = [];
    const result = await saveExportedProject({
      contents: "{}",
      showSaveFilePicker: async () => {
        throw Object.assign(new Error("cancel"), { name: "AbortError" });
      },
      promptFilename: () => "staging.json",
      download: (_contents, filename) => {
        downloads.push(filename);
      },
    });
    expect(result).toEqual({ status: "cancelled" });
    expect(downloads).toEqual([]);
  });

  it("downloads a custom name when the save dialog is unavailable", async () => {
    const downloads: string[] = [];
    const options: ExportSaveOptions = {
      contents: '{"ok":true}',
      promptFilename: (suggested) => {
        expect(suggested).toBe(".rogatio.json");
        return "staging.json";
      },
      download: (contents, filename) => {
        expect(contents).toBe('{"ok":true}');
        downloads.push(filename);
      },
    };
    await expect(saveExportedProject(options)).resolves.toEqual({
      status: "downloaded",
      filename: "staging.json",
    });
    expect(downloads).toEqual(["staging.json"]);
  });

  it("falls back to the download prompt when the save dialog fails", async () => {
    const downloads: string[] = [];
    const result = await saveExportedProject({
      contents: "{}",
      showSaveFilePicker: async () => {
        throw Object.assign(new Error("blocked"), { name: "NotAllowedError" });
      },
      promptFilename: () => "mocks/checkout",
      download: (_contents, filename) => {
        downloads.push(filename);
      },
    });
    expect(result).toEqual({
      status: "downloaded",
      filename: "checkout.json",
    });
    expect(downloads).toEqual(["checkout.json"]);
  });
});
