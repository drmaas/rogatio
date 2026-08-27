---
title: Response-body rewriting
description: Bounded textual replacement on authorized public GETs through the local runtime.
---

Response-body rewriting rules fetch an authorized public GET without browser credentials
and perform bounded textual replacement via native messaging to the explicitly started
local runtime.

## Behavior

- Authorized **public GET** only, without browser credentials.
- **Bounded textual replacement** of the response body.
- Routed through native messaging to the explicitly started local runtime.

## Requirements

- Requires the local runtime to be started (see [Local runtime](/guides/runtime/)).
- Activation is capability-based; where required capabilities are absent, activation reports
  `unsupported`.
- Observed bodies are never persisted, logged, exported, or transferred through native
  messaging.
