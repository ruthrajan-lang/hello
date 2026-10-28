const KEY = 'state';
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/state') return env.ASSETS.fetch(request);
    if (request.method === 'GET') {
      const v = await env.STATE.get(KEY);
      return json(v ? JSON.parse(v) : null);
    }
    if (request.method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (!body || typeof body !== 'object' || !body.f) return json({ error: 'not planner state' }, 400);
      if (JSON.stringify(body).length > 500_000) return json({ error: 'too large' }, 413);
      await env.STATE.put(KEY, JSON.stringify(body));
      return json({ ok: true, t: body.t });
    }
    return json({ error: 'method' }, 405);
  },
};
