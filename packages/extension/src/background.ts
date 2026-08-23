import {
  createPermissionAdapter,
  createStorageAdapter,
  setBadge,
} from "./chrome.js";
import { createExtensionApplication } from "./service-worker.js";

const api = chrome;
const application = createExtensionApplication({
  storage: createStorageAdapter(api),
  permissions: createPermissionAdapter(api),
  installer: {
    current: async () => [],
    install: async () => ({ ok: true }),
  },
  badge: (value) => setBadge(value, api),
});

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void application.handle(message).then(sendResponse);
  return true;
});
