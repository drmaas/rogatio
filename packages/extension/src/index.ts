export {
  type ChromeAction,
  type ChromeApi,
  type ChromePermissions,
  type ChromeRuntime,
  type ChromeStorageArea,
  createPermissionAdapter,
  createStorageAdapter,
  setBadge,
} from "./chrome.js";
export {
  type ExtensionDiagnostic,
  type ExtensionDiagnosticCode,
  extensionDiagnostic,
} from "./diagnostics.js";
export {
  createExtensionPageModel,
  type ExtensionPageModel,
  type ExtensionPageModelOptions,
} from "./extension-page.js";
export { declaredPermissionOrigins } from "./permissions.js";
export {
  type MatcherProjection,
  projectMatchers,
} from "./projection.js";
export {
  type ExtensionCommand,
  type ExtensionRequest,
  type ParseRequestResult,
  parseRequest,
} from "./protocol.js";
export {
  type ApplicationResponse,
  createExtensionApplication,
  type ExtensionApplication,
  type ExtensionApplicationOptions,
  type PermissionAdapter,
} from "./service-worker.js";
