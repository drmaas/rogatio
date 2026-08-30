import { createServer } from "node:http";

const PORT = 8080;
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "POST" && url.pathname === "/submit") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ receivedBody: body }));
    });
    return;
  }

  if (url.pathname === "/api/users") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ seenRequestHeaders: req.headers }));
    return;
  }

  if (url.pathname === "/api/page") {
    res.writeHead(200, { "x-test-header": "should-be-removed" });
    res.end("ok");
    return;
  }

  if (url.pathname === "/data.json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ value: "oldValue" }));
    return;
  }

  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});

server.listen(PORT, () =>
  console.log(`validation server on http://localhost:${PORT}`),
);
