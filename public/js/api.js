// Tiny fetch helper used by all the auth/dashboard pages.
window.api = {
  async req(method, path, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok) {
      const err = new Error((data && data.error) || `http_${r.status}`);
      err.status = r.status;
      err.payload = data;
      throw err;
    }
    return data;
  },
  get(p) { return this.req('GET', p); },
  post(p, b) { return this.req('POST', p, b); },
  put(p, b) { return this.req('PUT', p, b); },
  del(p) { return this.req('DELETE', p); },
};

window.requireAuth = async function () {
  try { return await api.get('/api/auth/me'); }
  catch (e) {
    if (e.status === 401) { location.href = '/login.html'; return null; }
    throw e;
  }
};
