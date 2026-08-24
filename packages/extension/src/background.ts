import {
  createPermissionAdapter,
  createStorageAdapter,
  setBadge,
} from "./chrome.js";
import { createDnrInstaller } from "./dnr.js";
import {
  createMockConnectionHolder,
  fetchMockConnection,
} from "./mock-runtime.js";
import { createExtensionApplication } from "./service-worker.js";

const api = chrome;
const mockConnectionHolder = createMockConnectionHolder();
const application = createExtensionApplication({
  storage: createStorageAdapter(api),
  permissions: createPermissionAdapter(api),
  installer: createDnrInstaller(api, {
    mockUrlResolver: (operation) =>
      mockConnectionHolder.mockUrl(operation.ruleId),
  }),
  badge: (value) => setBadge(value, api),
  mockRuntime: {
    fetchConnection: (port) => fetchMockConnection(port),
    setConnection: (connection) => mockConnectionHolder.set(connection),
  },
});

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void application.handle(message).then(sendResponse);
  return true;
});
