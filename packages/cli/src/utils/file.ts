export {
  createJsonFileProjectStorage,
  ProjectFileError,
  type ProjectRef,
  type ProjectStorage,
  ProjectStorageError,
  type ProjectStorageErrorCode,
} from "./project-storage.js";

import {
  createJsonFileProjectStorage,
  ProjectStorageError,
} from "./project-storage.js";

const defaultStorage = createJsonFileProjectStorage();

/** Compat wrapper: delegates to JSON-file storage `get`. */
export async function readProject(path: string): Promise<unknown> {
  return defaultStorage.get(path);
}

/** Compat wrapper: upsert via update, or create when missing. */
export async function writeProject(path: string, data: unknown): Promise<void> {
  try {
    await defaultStorage.update(path, data);
  } catch (e) {
    if (e instanceof ProjectStorageError && e.code === "not-found") {
      await defaultStorage.create({ id: path, data });
      return;
    }
    throw e;
  }
}
