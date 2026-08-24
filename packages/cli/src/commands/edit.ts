import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../server/http.js";
import {
  createRoutes,
  generateCsrfToken,
  type RouteContext,
} from "../server/routes.js";
import { launchBrowser } from "../utils/browser.js";
import { ProjectFileError, readProject, writeProject } from "../utils/file.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface EditCommandOptions {
  launchBrowser?: (url: string) => Promise<boolean>;
  port?: number;
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
      console.log(`Usage: rogatio edit [options] [path]
Options:
  --port <n>    Fixed port (default: random)
  --help        Show help`);
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

  // Read or create project
  let projectData: unknown;
  let isNewFile = false;
  try {
    projectData = await readProject(filePath);
  } catch (e) {
    if (e instanceof ProjectFileError && e.code === "not-found") {
      projectData = { version: 1, name: "", groups: [] };
      isNewFile = true;
    } else {
      console.error(`Error: ${e}`);
      return { exitCode: Promise.resolve(2), shutdown: () => {} };
    }
  }

  // Write initial project for new files
  if (isNewFile) {
    try {
      await writeProject(filePath, projectData);
    } catch (e) {
      console.error(`Error writing initial project: ${e}`);
      return { exitCode: Promise.resolve(2), shutdown: () => {} };
    }
  }

  // Generate CSRF token
  const csrfToken = generateCsrfToken();

  const context: RouteContext = {
    project: projectData,
    filePath,
    csrfToken,
    writeProject,
    shutdown: () => {
      shutdown();
    },
    editorHtml: "",
    editorBundlePath: "",
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

  // Resolve the @rogatio/editor browser bundle so the editor page can load it
  let editorBundlePath: string;
  try {
    editorBundlePath = fileURLToPath(import.meta.resolve("@rogatio/editor"));
  } catch (e) {
    console.error(`Error: cannot resolve @rogatio/editor bundle: ${e}`);
    await server.stop();
    return { exitCode: Promise.resolve(2), shutdown: () => {} };
  }

  context.editorHtml = generateEditorHtml(serverUrl, csrfToken, filePath);
  context.editorBundlePath = editorBundlePath;

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
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rogatio Editor</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    #editor-root { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
   <div id="editor-root"></div>
   <script type="importmap">
     { "imports": { "@rogatio/editor": "/vendor/editor.js" } }
   </script>
   <script type="module">
      import { createEditor, createRedirectRuleType } from '@rogatio/editor';
    
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
      ruleTypes: [createRedirectRuleType()],
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
    });
  </script>
</body>
</html>`;
}
