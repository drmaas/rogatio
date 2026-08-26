import { compileProject } from "@rogatio/compiler";
import {
  LIMITS,
  normalizeSiteOrigin,
  type RogatioProject,
  validateProjectDetailed,
} from "@rogatio/schema";
import type { CoreDiagnostic } from "./diagnostics.js";
import { coreDiagnostic } from "./diagnostics.js";
import { migrateEnvelope } from "./migrate.js";
import { computeDeclaredOrigins } from "./status.js";
import type {
  CoreResult,
  StorageAdapter,
  StoredEnvelope,
  StoredProject,
} from "./types.js";

export const MAX_PROJECTS = 64;

export interface RepositoryOptions {
  readonly storage: StorageAdapter;
  readonly generateId?: () => string;
  readonly now?: () => number;
}

type Mutation<T> =
  | {
      readonly kind: "commit";
      readonly next: StoredEnvelope;
      readonly value: T;
    }
  | { readonly kind: "conflict"; readonly current: StoredProject }
  | {
      readonly kind: "failure";
      readonly diagnostics: readonly CoreDiagnostic[];
    };

interface MutateOptions {
  readonly retry: boolean;
  readonly conflictProject?: (current: StoredEnvelope) => StoredProject | null;
}

type ValidationOutcome =
  | {
      readonly ok: true;
      readonly project: RogatioProject;
      readonly declared: readonly string[];
    }
  | { readonly ok: false; readonly diagnostics: readonly CoreDiagnostic[] };

function failed<T>(
  diagnostics: readonly CoreDiagnostic[],
): Extract<CoreResult<T>, { ok: false }> {
  return { ok: false, kind: "failure", diagnostics };
}

function replaceProject(
  envelope: StoredEnvelope,
  project: StoredProject,
): StoredEnvelope {
  return {
    ...envelope,
    projects: { ...envelope.projects, [project.id]: project },
  };
}

export class ProjectRepository {
  private readonly storage: StorageAdapter;
  private readonly generateId: () => string;
  private readonly now: () => number;

  constructor(options: RepositoryOptions) {
    this.storage = options.storage;
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
  }

  async state(): Promise<CoreResult<StoredEnvelope>> {
    const read = await this.readEnvelope();
    if (!read.ok) return failed(read.diagnostics);
    return { ok: true, value: structuredClone(read.envelope) };
  }

  async createProject(
    data: unknown,
    options: { readonly id?: string } = {},
  ): Promise<CoreResult<StoredProject>> {
    const id = this.resolveId(options.id);
    if (!id.ok) return failed(id.diagnostics);
    return this.mutate((current) => this.buildCreate(current, data, id.value), {
      retry: true,
    });
  }

  async importProject(
    data: unknown,
    options: { readonly id?: string; readonly expectedRevision?: number } = {},
  ): Promise<CoreResult<StoredProject>> {
    if (options.id !== undefined) {
      const resolved = this.resolveId(options.id);
      if (!resolved.ok) return failed(resolved.diagnostics);
    }
    let generated: string | undefined;
    const idForCreate = (): string => {
      if (options.id !== undefined) return options.id;
      if (generated === undefined) generated = this.generateId();
      return generated;
    };
    // Retry on CAS failure: the rebuild re-reads the committed revision and
    // returns a conflict when an explicit expected revision no longer matches.
    return this.mutate(
      (current) => this.buildImport(current, data, options, idForCreate),
      { retry: true },
    );
  }

  async saveProject(
    projectId: string,
    data: unknown,
    expectedRevision: number,
  ): Promise<CoreResult<StoredProject>> {
    return this.mutate(
      (current) => {
        const existing = current.projects[projectId];
        if (existing === undefined) {
          return {
            kind: "failure",
            diagnostics: [coreDiagnostic("core.not-found", { projectId })],
          };
        }
        if (existing.revision !== expectedRevision) {
          return { kind: "conflict", current: structuredClone(existing) };
        }
        return this.buildUpdate(current, existing, data, expectedRevision);
      },
      {
        retry: false,
        conflictProject: (current) => current.projects[projectId] ?? null,
      },
    );
  }

  async switchProject(projectId: string): Promise<CoreResult<StoredEnvelope>> {
    return this.mutate(
      (current) => {
        if (current.projects[projectId] === undefined) {
          return {
            kind: "failure",
            diagnostics: [coreDiagnostic("core.not-found", { projectId })],
          };
        }
        const next: StoredEnvelope = {
          ...current,
          activeProjectId: projectId,
        };
        return { kind: "commit", next, value: structuredClone(next) };
      },
      { retry: true },
    );
  }

  async removeProject(projectId: string): Promise<CoreResult<StoredEnvelope>> {
    return this.mutate(
      (current) => {
        if (current.projects[projectId] === undefined) {
          return {
            kind: "failure",
            diagnostics: [coreDiagnostic("core.not-found", { projectId })],
          };
        }
        const projects = { ...current.projects };
        delete projects[projectId];
        let activeProjectId = current.activeProjectId;
        if (activeProjectId === projectId) {
          const remaining = Object.values(projects);
          if (remaining.length === 0) {
            activeProjectId = null;
          } else {
            const sorted = [...remaining].sort((left, right) => {
              if (left.updatedAt !== right.updatedAt) {
                return left.updatedAt - right.updatedAt;
              }
              return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
            });
            activeProjectId = sorted[sorted.length - 1]?.id ?? null;
          }
        }
        const next: StoredEnvelope = { version: 1, projects, activeProjectId };
        return { kind: "commit", next, value: structuredClone(next) };
      },
      { retry: true },
    );
  }

  async setGroupEnabled(
    projectId: string,
    groupId: string,
    enabled: boolean,
  ): Promise<CoreResult<StoredProject>> {
    return this.mutate(
      (current) => {
        const existing = current.projects[projectId];
        if (existing === undefined) {
          return {
            kind: "failure",
            diagnostics: [coreDiagnostic("core.not-found", { projectId })],
          };
        }
        if (!existing.data.groups.some((group) => group.id === groupId)) {
          return {
            kind: "failure",
            diagnostics: [
              coreDiagnostic("core.not-found", { projectId, groupId }),
            ],
          };
        }
        const enabledSet = new Set(existing.enabledGroupIds);
        if (enabled) {
          enabledSet.add(groupId);
        } else {
          enabledSet.delete(groupId);
        }
        const project: StoredProject = {
          ...existing,
          enabledGroupIds: [...enabledSet],
          revision: existing.revision + 1,
          updatedAt: this.now(),
        };
        return {
          kind: "commit",
          next: replaceProject(current, project),
          value: structuredClone(project),
        };
      },
      { retry: true },
    );
  }

  async grantOrigin(
    projectId: string,
    origin: string,
  ): Promise<CoreResult<StoredProject>> {
    const normalized = normalizeSiteOrigin(origin);
    if (normalized === null) {
      return failed([coreDiagnostic("core.invalid-origin")]);
    }
    return this.mutate(
      (current) => {
        const existing = current.projects[projectId];
        if (existing === undefined) {
          return {
            kind: "failure",
            diagnostics: [coreDiagnostic("core.not-found", { projectId })],
          };
        }
        const declared = computeDeclaredOrigins(existing.data);
        if (!declared.ok) {
          return { kind: "failure", diagnostics: declared.diagnostics };
        }
        if (!declared.value.includes(normalized)) {
          return {
            kind: "failure",
            diagnostics: [
              coreDiagnostic("core.permission-undeclared", { projectId }),
            ],
          };
        }
        const grantedOrigins = existing.grantedOrigins.includes(normalized)
          ? existing.grantedOrigins
          : [...existing.grantedOrigins, normalized];
        const project: StoredProject = {
          ...existing,
          grantedOrigins,
          revision: existing.revision + 1,
          updatedAt: this.now(),
        };
        return {
          kind: "commit",
          next: replaceProject(current, project),
          value: structuredClone(project),
        };
      },
      { retry: true },
    );
  }

  async revokeOrigin(
    projectId: string,
    origin: string,
  ): Promise<CoreResult<StoredProject>> {
    const normalized = normalizeSiteOrigin(origin);
    if (normalized === null) {
      return failed([coreDiagnostic("core.invalid-origin")]);
    }
    return this.mutate(
      (current) => {
        const existing = current.projects[projectId];
        if (existing === undefined) {
          return {
            kind: "failure",
            diagnostics: [coreDiagnostic("core.not-found", { projectId })],
          };
        }
        const grantedOrigins = existing.grantedOrigins.filter(
          (granted) => granted !== normalized,
        );
        const project: StoredProject = {
          ...existing,
          grantedOrigins,
          revision: existing.revision + 1,
          updatedAt: this.now(),
        };
        return {
          kind: "commit",
          next: replaceProject(current, project),
          value: structuredClone(project),
        };
      },
      { retry: true },
    );
  }

  async getProject(projectId: string): Promise<CoreResult<StoredProject>> {
    const read = await this.readEnvelope();
    if (!read.ok) return failed(read.diagnostics);
    const project = read.envelope.projects[projectId];
    if (project === undefined) {
      return failed([coreDiagnostic("core.not-found", { projectId })]);
    }
    return { ok: true, value: structuredClone(project) };
  }

  async exportProject(projectId: string): Promise<CoreResult<RogatioProject>> {
    const read = await this.readEnvelope();
    if (!read.ok) return failed(read.diagnostics);
    const project = read.envelope.projects[projectId];
    if (project === undefined) {
      return failed([coreDiagnostic("core.not-found", { projectId })]);
    }
    return { ok: true, value: structuredClone(project.data) };
  }

  private resolveId(requestedId: string | undefined):
    | { readonly ok: true; readonly value: string }
    | {
        readonly ok: false;
        readonly diagnostics: readonly CoreDiagnostic[];
      } {
    const id = requestedId ?? this.generateId();
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > LIMITS.maxIdLength
    ) {
      return {
        ok: false,
        diagnostics: [coreDiagnostic("core.invariant", { projectId: id })],
      };
    }
    return { ok: true, value: id };
  }

  private buildCreate(
    current: StoredEnvelope,
    data: unknown,
    id: string,
  ): Mutation<StoredProject> {
    const validated = this.validateData(data);
    if (!validated.ok) {
      return { kind: "failure", diagnostics: validated.diagnostics };
    }
    for (const existing of Object.values(current.projects)) {
      if (existing.name === validated.project.name) {
        return {
          kind: "failure",
          diagnostics: [coreDiagnostic("core.duplicate-name")],
        };
      }
    }
    if (Object.keys(current.projects).length >= MAX_PROJECTS) {
      return {
        kind: "failure",
        diagnostics: [
          coreDiagnostic("core.project-limit", { limit: MAX_PROJECTS }),
        ],
      };
    }
    if (current.projects[id] !== undefined) {
      return {
        kind: "failure",
        diagnostics: [coreDiagnostic("core.duplicate-id", { projectId: id })],
      };
    }
    const stamp = this.now();
    const project: StoredProject = {
      id,
      name: validated.project.name,
      data: validated.project,
      revision: 1,
      createdAt: stamp,
      updatedAt: stamp,
      enabledGroupIds: [],
      grantedOrigins: [],
    };
    const firstProject = Object.keys(current.projects).length === 0;
    const next: StoredEnvelope = {
      version: 1,
      projects: { ...current.projects, [id]: project },
      activeProjectId: firstProject ? id : current.activeProjectId,
    };
    return { kind: "commit", next, value: structuredClone(project) };
  }

  private buildImport(
    current: StoredEnvelope,
    data: unknown,
    options: { readonly id?: string; readonly expectedRevision?: number },
    idForCreate: () => string,
  ): Mutation<StoredProject> {
    const validated = this.validateData(data);
    if (!validated.ok) {
      return { kind: "failure", diagnostics: validated.diagnostics };
    }

    const existing =
      options.id !== undefined
        ? current.projects[options.id]
        : Object.values(current.projects).find(
            (project) => project.name === validated.project.name,
          );
    if (existing === undefined) {
      return this.buildCreate(current, data, idForCreate());
    }
    return this.buildUpdate(current, existing, data, options.expectedRevision);
  }

  private buildUpdate(
    current: StoredEnvelope,
    existing: StoredProject,
    data: unknown,
    expectedRevision: number | undefined,
  ): Mutation<StoredProject> {
    if (
      expectedRevision !== undefined &&
      existing.revision !== expectedRevision
    ) {
      return { kind: "conflict", current: structuredClone(existing) };
    }
    const validated = this.validateData(data);
    if (!validated.ok) {
      return { kind: "failure", diagnostics: validated.diagnostics };
    }
    if (validated.project.name !== existing.name) {
      for (const other of Object.values(current.projects)) {
        if (other.id !== existing.id && other.name === validated.project.name) {
          return {
            kind: "failure",
            diagnostics: [coreDiagnostic("core.duplicate-name")],
          };
        }
      }
    }
    const declaredSet = new Set(validated.declared);
    const grantedOrigins = existing.grantedOrigins.filter((origin) =>
      declaredSet.has(origin),
    );
    const project: StoredProject = {
      ...existing,
      name: validated.project.name,
      data: validated.project,
      revision: existing.revision + 1,
      updatedAt: this.now(),
      enabledGroupIds: [],
      grantedOrigins,
    };
    return {
      kind: "commit",
      next: replaceProject(current, project),
      value: structuredClone(project),
    };
  }

  private validateData(data: unknown): ValidationOutcome {
    const validation = validateProjectDetailed(data);
    if (!validation.valid) {
      const compiled = compileProject(data);
      if (!compiled.ok) {
        return { ok: false, diagnostics: compiled.diagnostics };
      }
      return { ok: false, diagnostics: [coreDiagnostic("core.invariant")] };
    }
    const declared = computeDeclaredOrigins(validation.data);
    if (!declared.ok) {
      return { ok: false, diagnostics: declared.diagnostics };
    }
    return {
      ok: true,
      project: structuredClone(validation.data),
      declared: declared.value,
    };
  }

  private async readEnvelope(): Promise<
    | {
        readonly ok: true;
        readonly raw: unknown;
        readonly envelope: StoredEnvelope;
      }
    | { readonly ok: false; readonly diagnostics: readonly CoreDiagnostic[] }
  > {
    let raw: unknown;
    try {
      raw = await this.storage.read();
      console.log(
        "[DEBUG] readEnvelope: storage.read() returned",
        raw === undefined ? "undefined" : typeof raw,
      );
    } catch (e) {
      console.log("[DEBUG] readEnvelope: storage.read() threw", e);
      return {
        ok: false,
        diagnostics: [coreDiagnostic("core.storage-corrupt")],
      };
    }
    const migrated = migrateEnvelope(raw);
    console.log(
      "[DEBUG] readEnvelope: migrateEnvelope returned",
      migrated.ok ? "ok" : "failed",
      migrated.ok ? "" : migrated.diagnostic,
    );
    if (!migrated.ok) {
      return { ok: false, diagnostics: [migrated.diagnostic] };
    }
    return { ok: true, raw, envelope: migrated.envelope };
  }

  private async mutate<T>(
    build: (current: StoredEnvelope) => Mutation<T>,
    options: MutateOptions,
  ): Promise<CoreResult<T>> {
    const attempts = options.retry ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const read = await this.readEnvelope();
      if (!read.ok) {
        return { ok: false, kind: "failure", diagnostics: read.diagnostics };
      }
      const mutation = build(read.envelope);
      if (mutation.kind === "conflict") {
        return {
          ok: false,
          kind: "conflict",
          current: mutation.current,
          diagnostics: [coreDiagnostic("core.conflict")],
        };
      }
      if (mutation.kind === "failure") {
        return {
          ok: false,
          kind: "failure",
          diagnostics: mutation.diagnostics,
        };
      }

      let swapped = false;
      try {
        swapped = await this.storage.compareAndSwap(read.raw, mutation.next);
      } catch {
        swapped = false;
      }
      if (swapped) return { ok: true, value: mutation.value };

      if (options.conflictProject !== undefined) {
        const fresh = await this.readEnvelope();
        if (!fresh.ok) {
          return { ok: false, kind: "failure", diagnostics: fresh.diagnostics };
        }
        const current = options.conflictProject(fresh.envelope);
        if (current !== null) {
          return {
            ok: false,
            kind: "conflict",
            current,
            diagnostics: [coreDiagnostic("core.conflict")],
          };
        }
      }
    }
    return {
      ok: false,
      kind: "failure",
      diagnostics: [coreDiagnostic("core.storage-conflict")],
    };
  }
}
