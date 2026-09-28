/**
 * The synthesis server, served over HTTP on Node.
 *
 * The handler in src/index.mjs is written as a fetch function so the same code
 * can run on any platform that speaks Request and Response. This is the thinnest
 * thing that adapts Node's http server to that, so the code that is deployed is
 * the code that is tested.
 *
 * It reads its configuration from process.env, and so does a Cloudflare Worker:
 * under the nodejs_compat flag workerd populates process.env from vars and
 * secrets, including at module scope, which is where src/lib/config.mjs reads
 * it. The same src/index.mjs therefore runs unchanged on both, and this file
 * exists only so the service can also be run on plain Node, which is what the
 * test suite and a local `npm start` use.
 */
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import worker from './src/index.mjs';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

const server = createServer(async (req, res) => {
  const url = `http://${req.headers.host || `localhost:${PORT}`}${req.url}`;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const method = req.method || 'GET';
  const request = new Request(url, {
    method,
    headers: req.headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });

  try {
    const response = await worker.fetch(request);
    const headers = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    res.writeHead(response.status, headers);
    if (response.body) {
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(error.message || error) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`listen listening on http://${HOST}:${PORT}`);
});

process.on('unhandledRejection', (error) => {
  console.error('unhandled rejection:', error);
});
