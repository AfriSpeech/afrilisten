// One scenario per process: env is set before the first import, exactly as in production.
const which = process.argv[2];
const env = { none: {}, key: { LISTEN_API_KEY: 'secret-abc' },
  origins: { LISTEN_API_KEY: 'secret-abc', LISTEN_ALLOWED_ORIGINS: 'https://example.com, https://www.example.com' },
  wild: { LISTEN_API_KEY: 'secret-abc', LISTEN_ALLOWED_ORIGINS: '*' } }[which];
for (const [k, v] of Object.entries(env)) process.env[k] = v;
// Resolved relative to this file so the suite works from any checkout.
const target = new URL('../src/lib/auth.mjs', import.meta.url).href;
const { checkAuth, corsHeaders } = await import(target);
const req = (h) => new Request('https://x/speak', { headers: h });
const out = {
  noKeyFailsClosed: checkAuth(req({ 'x-listen-key': 'x' })).status,
  missing: checkAuth(req({})).status,
  wrong: checkAuth(req({ 'x-listen-key': 'secret-abd' })).status,
  prefix: checkAuth(req({ 'x-listen-key': 'secret-ab' })).status,
  longer: checkAuth(req({ 'x-listen-key': 'secret-abcx' })).status,
  right: checkAuth(req({ 'x-listen-key': 'secret-abc' })).ok,
  goodOrigin: checkAuth(req({ 'x-listen-key': 'secret-abc', origin: 'https://example.com' })).ok,
  evilOrigin: checkAuth(req({ 'x-listen-key': 'secret-abc', origin: 'https://evil.test' })).status,
  noOrigin: checkAuth(req({ 'x-listen-key': 'secret-abc' })).ok,
  echoGood: corsHeaders(req({ origin: 'https://example.com' }))['access-control-allow-origin'] ?? null,
  echoEvil: corsHeaders(req({ origin: 'https://evil.test' }))['access-control-allow-origin'] ?? null,
  echoAny: corsHeaders(req({ origin: 'https://any.test' }))['access-control-allow-origin'] ?? null,
  methods: corsHeaders(req({}))['access-control-allow-methods'],
};
console.log(JSON.stringify(out));
