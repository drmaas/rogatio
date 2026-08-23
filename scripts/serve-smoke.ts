import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, relative, resolve, sep } from "node:path";

const fixtureRoot = resolve(import.meta.dirname, "../test/fixtures");
const browserRoot = resolve(
  import.meta.dirname,
  "../packages/smoke/dist/browser",
);
const editorRoot = resolve(
  import.meta.dirname,
  "../packages/editor/dist/browser",
);
function resolveWithin(root: string, requestPath: string): string | undefined {
  const candidate = resolve(root, requestPath);
  const relativePath = relative(root, candidate);
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  )
    return undefined;
  return candidate;
}
const server = createServer(async (request, response) => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://127.0.0.1:4173").pathname,
    );
  } catch {
    response.writeHead(400);
    response.end("Invalid request");
    return;
  }
  const requestPath = pathname.slice(1);
  const filePath = requestPath.startsWith("browser/")
    ? resolveWithin(browserRoot, requestPath.slice("browser/".length))
    : requestPath.startsWith("editor/")
      ? resolveWithin(editorRoot, requestPath.slice("editor/".length))
      : resolveWithin(fixtureRoot, requestPath);
  if (!filePath) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  try {
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "content-type": filePath.endsWith(".html")
        ? "text/html"
        : "text/javascript",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
server.listen(4173, "127.0.0.1", () =>
  console.log("Smoke server listening on http://127.0.0.1:4173"),
);
