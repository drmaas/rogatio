export interface ExtensionPageModelOptions {
  readonly activeProjectId: string | null;
  readonly projectIds: readonly string[];
  readonly switchProject: (projectId: string) => void;
}

export interface ExtensionPageModel {
  select(projectId: string): void;
  pendingProjectId(): string | null;
  switch(): void;
}

export function createExtensionPageModel(
  options: ExtensionPageModelOptions,
): ExtensionPageModel {
  let pending = options.activeProjectId;
  const available = new Set(options.projectIds);
  return {
    select(projectId) {
      if (available.has(projectId)) pending = projectId;
    },
    pendingProjectId() {
      return pending;
    },
    switch() {
      if (pending !== null && available.has(pending))
        options.switchProject(pending);
    },
  };
}
