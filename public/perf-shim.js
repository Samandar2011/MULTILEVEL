/* perf-shim.js — qotib qolishning oldini oladi.
   1) MutationObserver chaqiruvlari bir kadrda BITTAGA birlashtiriladi
      (enhance.js / fixes.js har bir DOM o'zgarishida qayta ishga tushib, so'rov yuborardi).
   2) GET /api/tests javobi 15 soniya xotirada saqlanadi va bir vaqtdagi bir xil so'rovlar birlashtiriladi.
   3) Sessiya eskirgan bo'lsa (401) — eski token tozalanib, login sahifasi ochiladi. */
(() => {
  const NativeMO = window.MutationObserver;
  if (NativeMO && !NativeMO.__cefrPatched) {
    window.MutationObserver = class extends NativeMO {
      constructor(callback) {
        let queued = false, records = [];
        super((mutations, observer) => {
          records.push(...mutations);
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            const batch = records; records = [];
            callback(batch, observer);
          });
        });
      }
    };
    window.MutationObserver.__cefrPatched = true;
  }

  const nativeFetch = window.fetch.bind(window);
  const memo = new Map();
  const TTL = 15000;
  const urlOf = input => (typeof input === 'string' ? input : (input && input.url) || '');
  const authOf = opts => {
    const h = opts && opts.headers;
    if (!h) return '';
    if (typeof h.get === 'function') return h.get('Authorization') || '';
    return h.Authorization || h.authorization || '';
  };

  // Sessiya eskirgan (yoki umuman kirilmagan) bo‘lsa: server 401 qaytaradi. Oldin bu "Sahifa yuklanmadi"
  // ekraniga olib kelardi va login sahifasiga chiqib bo‘lmasdi. Endi eski ma’lumot tozalanib, login ochiladi.
  const sessionLost = () => {
    try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch (e) {}
    const target = location.pathname.startsWith('/admin') ? '/admin/login' : '/login';
    if (location.pathname !== target) location.assign(target);
    return new Promise(() => {}); // sahifa almashguncha kutamiz, xato ekrani chiqmasin
  };
  const rawFetch = (input, opts) =>
    nativeFetch(input, opts).then(res =>
      res.status === 401 && !/\/api\/auth\//.test(urlOf(input)) ? sessionLost() : res);

  window.fetch = (input, opts = {}) => {
    const url = urlOf(input);
    const method = String(opts.method || (typeof input === 'object' && input && input.method) || 'GET').toUpperCase();
    if (method !== 'GET') { memo.clear(); return rawFetch(input, opts); }
    if (!/\/api\/tests$/.test(url)) return rawFetch(input, opts);
    const key = url + '|' + authOf(opts);
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < TTL) {
      return hit.promise.then(r => new Response(r.text, { status: r.status, headers: { 'Content-Type': 'application/json' } }));
    }
    const promise = nativeFetch(input, opts).then(async res => ({ status: res.status, text: await res.text() }));
    memo.set(key, { at: Date.now(), promise });
    promise.then(r => { if (r.status >= 400) memo.delete(key); }, () => memo.delete(key));
    return promise.then(r => new Response(r.text, { status: r.status, headers: { 'Content-Type': 'application/json' } }));
  };
})();
