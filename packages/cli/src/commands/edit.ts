import { resolve } from "node:path";
import { createAIClient, readProviderConfig } from "@rogatio/runtime";
import { showEditHelp } from "../help.js";
import { createServer } from "../server/http.js";
import {
  createRoutes,
  generateCsrfToken,
  type RouteContext,
} from "../server/routes.js";
import { editorAssetPaths } from "../utils/asset-paths.js";
import { launchBrowser } from "../utils/browser.js";
import {
  createJsonFileProjectStorage,
  type ProjectStorage,
  ProjectStorageError,
} from "../utils/file.js";
import { emptyProjectDocument } from "../utils/project-storage.js";

export interface EditCommandOptions {
  launchBrowser?: (url: string) => Promise<boolean>;
  port?: number;
  storage?: ProjectStorage;
}

export interface EditCommandResult {
  exitCode: Promise<number>;
  shutdown: () => void;
}

export async function editCommand(
  args: string[],
  options: EditCommandOptions = {},
): Promise<EditCommandResult> {
  const customLaunchBrowser = options.launchBrowser;
  const storage = options.storage ?? createJsonFileProjectStorage();

  // Parse arguments
  const positionalArgs: string[] = [];
  let port: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && i + 1 < args.length) {
      port = parseInt(args[++i], 10);
      if (Number.isNaN(port)) {
        console.error("Error: Invalid port number");
        return { exitCode: Promise.resolve(2), shutdown: () => {} };
      }
    } else if (!arg.startsWith("-")) {
      positionalArgs.push(arg);
    } else if (arg === "--help") {
      showEditHelp();
      return { exitCode: Promise.resolve(0), shutdown: () => {} };
    } else {
      console.error(`Error: Unknown option: ${arg}`);
      return { exitCode: Promise.resolve(2), shutdown: () => {} };
    }
  }

  if (positionalArgs.length > 1) {
    console.error("Error: Too many arguments");
    return { exitCode: Promise.resolve(2), shutdown: () => {} };
  }

  // Resolve file path
  let filePath: string;
  if (positionalArgs[0]) {
    filePath = resolve(positionalArgs[0]);
  } else {
    filePath = resolve(process.cwd(), ".rogatio.json");
  }

  // Check if path is a directory
  try {
    const stat = await import("node:fs/promises").then((fs) =>
      fs.stat(filePath),
    );
    if (stat.isDirectory()) {
      console.error("Error: Path is a directory");
      return { exitCode: Promise.resolve(2), shutdown: () => {} };
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Error: ${e}`);
      return { exitCode: Promise.resolve(2), shutdown: () => {} };
    }
    // File doesn't exist, will be created
  }

  // Read or create project via ProjectStorage
  let projectData: unknown;
  try {
    projectData = await storage.get(filePath);
  } catch (e) {
    if (e instanceof ProjectStorageError && e.code === "not-found") {
      try {
        await storage.create({ id: filePath });
        projectData = emptyProjectDocument();
      } catch (createError) {
        console.error(`Error writing initial project: ${createError}`);
        return { exitCode: Promise.resolve(2), shutdown: () => {} };
      }
    } else {
      console.error(`Error: ${e}`);
      return { exitCode: Promise.resolve(2), shutdown: () => {} };
    }
  }

  // Read AI provider config
  let aiClient: ReturnType<typeof createAIClient> | undefined;
  const providerConfig = await readProviderConfig();
  if (providerConfig) {
    aiClient = createAIClient(providerConfig);
  }

  // Generate CSRF token
  const csrfToken = generateCsrfToken();

  const context: RouteContext = {
    project: projectData,
    filePath,
    csrfToken,
    storage,
    shutdown: () => {
      shutdown();
    },
    editorHtml: "",
    editorBundlePath: "",
    editorCssPath: "",
    editorFontsPath: "",
    aiClient,
  };

  // Create and start server (optionally on a fixed port)
  let server: ReturnType<typeof createServer>;
  try {
    server = createServer(
      createRoutes(context),
      port !== undefined ? { port } : {},
    );
    await server.start();
  } catch (e) {
    console.error(`Error starting server: ${e}`);
    return { exitCode: Promise.resolve(2), shutdown: () => {} };
  }

  const serverUrl = `http://127.0.0.1:${server.port}`;
  const editorUrl = `${serverUrl}/editor.html`;

  // Locate the editor bundle, css, and fonts from the published tarball
  // (or the workspace editor build during development).
  const {
    bundle: editorBundlePath,
    css: editorCssPath,
    fonts: editorFontsPath,
  } = editorAssetPaths();

  context.editorHtml = generateEditorHtml(
    serverUrl,
    csrfToken,
    filePath,
    !!aiClient,
  );
  context.editorBundlePath = editorBundlePath;
  context.editorCssPath = editorCssPath;
  context.editorFontsPath = editorFontsPath;

  let shutdownCalled = false;
  function shutdown() {
    shutdownCalled = true;
    server.stop();
  }

  // Launch browser
  const browserLaunched = await (customLaunchBrowser ?? launchBrowser)(
    editorUrl,
  );
  if (!browserLaunched) {
    console.log(`Editor available at: ${editorUrl}`);
    console.log("Open this URL in your browser to edit the project.");
  }

  // Wait for shutdown signal
  const exitCodePromise = new Promise<number>((resolve) => {
    const checkShutdown = setInterval(() => {
      if (shutdownCalled) {
        clearInterval(checkShutdown);
        resolve(0);
      }
    }, 100);

    // Handle signals
    const handleSignal = () => {
      shutdown();
    };
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);

    // Cleanup on resolve
    const originalResolve = resolve;
    resolve = (code) => {
      clearInterval(checkShutdown);
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
      originalResolve(code);
    };
  });

  return {
    exitCode: exitCodePromise,
    shutdown,
  };
}

function generateEditorHtml(
  apiBase: string,
  csrfToken: string,
  filePath: string,
  aiConfigured: boolean,
): string {
  const aiAssistHandler = aiConfigured
    ? `
    aiAssist: async function*(request) {
      const res = await fetch(apiBase + '/api/ai/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          messages: request.context.project ? [
            { role: 'system', content: 'You are an expert Rogatio rule author.' },
            { role: 'user', content: request.prompt }
          ] : [{ role: 'user', content: request.prompt }],
          model: 'gpt-4o-mini',
          stream: true,
        }),
      });
      
      if (!res.ok) {
        const error = await res.json();
        yield { type: 'error', error: error.message };
        return;
      }
      
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        yield { type: 'error', error: 'No response body' };
        return;
      }
      
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'token' && parsed.content) {
              yield { type: 'token', content: parsed.content };
            } else if (parsed.done) {
              yield { type: 'done', proposal: parsed.proposal };
              return;
            } else if (parsed.error) {
              yield { type: 'error', error: parsed.error };
              return;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
      yield { type: 'done', proposal: null };
    },`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rogatio Editor</title>
  <link rel="stylesheet" href="/vendor/editor.css" />
  <style>
    html, body { margin: 0; min-height: 100%; }
    body {
      background-color: #121417;
      background-image: radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    #editor-root { min-height: 100vh; }
  </style>
</head>
<body>
   <div id="editor-root"></div>
   <script type="importmap">
     { "imports": { "@rogatio/editor": "/vendor/editor.js" } }
   </script>
   <script type="module">
      import { createEditor, createMockRuleType, createRedirectRuleType, createResponseBodyRuleType } from '@rogatio/editor';
    
    const root = document.getElementById('editor-root');
    const apiBase = '${apiBase}';
    const csrfToken = '${csrfToken}';
    const filePath = '${filePath}';
    
    async function fetchProject() {
      const res = await fetch(apiBase + '/api/project');
      return res.json();
    }
    
    async function validateProject(project) {
      const res = await fetch(apiBase + '/api/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(project),
      });
      return res.json();
    }
    
    async function saveProject(project) {
      const res = await fetch(apiBase + '/api/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(project),
      });
      return res.json();
    }
    
    async function cancel() {
      await fetch(apiBase + '/api/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: '{}',
      });
    }
    
    const project = await fetchProject();
    
    const editor = createEditor(root, {
      ruleTypes: [createRedirectRuleType(), createMockRuleType(), createResponseBodyRuleType()],
      initialProject: project,
      validate: async (value) => {
        const result = await validateProject(value);
        return result.diagnostics.map((d: any) => ({
          code: d.code,
          severity: d.severity,
          path: d.path,
          message: d.message,
        }));
      },
      save: async (project) => {
        const result = await saveProject(project);
        if (result.ok) {
          return { ok: true };
        }
        return { ok: false, code: result.code, message: result.message };
      },
      dryRun: async (currentProject, cases, options) => {
        const res = await fetch(apiBase + '/api/dry-run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ project: currentProject, cases, options }),
        });
        return res.json();
      },
      onCancel: () => {
        cancel();
      },
      ${aiAssistHandler}
    });
  </script>
</body>
</html>`;
}
