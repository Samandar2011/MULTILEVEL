/* vip.js — VIP / Premium a'zolik: talaba sahifasi va admin boshqaruvi.
   Ruxsat mantig'i FAQAT serverda (server.js: TIER_FEATURES/hasAccess). Bu fayl faqat serverdan kelgan
   ma'lumotni (membership, plans, comparison, history) ko'rsatadi — hech qanday tarif/ruxsat hisobini
   o'zi qilmaydi va hech qanday so'rovda membershipType/Expire/Status maydonini to'g'ridan-to'g'ri yubormaydi.
   Talaba o'zi uchun tarifni HECH QACHON o'zgartira olmaydi: /vip sahifasidagi muddat tugmalari faqat
   tanlovni ko'rsatadi va Support markaziga yo'naltiradi; faollashtirish FAQAT admin panelidan bo'ladi. */

const MEM_UI = { FREE: ['', 'FREE'], SILVER: ['🥈', 'SILVER VIP'], GOLD: ['🥇', 'GOLD VIP'], PLATINUM: ['💎', 'PLATINUM VIP'] };
const memDay = v => { const t = new Date(v); return isNaN(t) ? '—' : t.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Tashkent' }).replace(/\//g, '.'); };
const memText = m => { const u = MEM_UI[(m && m.type)] || MEM_UI.FREE; return (u[0] ? u[0] + ' ' : '') + u[1]; };
// FREE foydalanuvchida badge ko'rsatilmaydi (talabga ko'ra).
const vipBadge = m => (m && m.type && m.type !== 'FREE') ? ` <span class="vip-badge vip-badge-${m.type.toLowerCase()}" title="${esc(MEM_UI[m.type][1])}">${MEM_UI[m.type][0]}</span>` : '';

const membershipCard = m => {
  m = m || { type: 'FREE' };
  const t = MEM_UI[m.type] ? m.type : 'FREE', active = t !== 'FREE' && m.status !== 'EXPIRED';
  const rows = active
    ? `<div class="mem-rows"><div class="mem-row"><span>Status</span><b class="mem-status-active">ACTIVE</b></div><div class="mem-row"><span>Start Date</span><b>${memDay(m.startDate)}</b></div><div class="mem-row"><span>Expiration Date</span><b>${memDay(m.expireDate)}</b></div><div class="mem-row"><span>Days Remaining</span><b>${m.daysLeft ?? 0} kun</b></div></div>`
    : (m.status === 'EXPIRED' && m.expireDate ? `<div class="mem-rows"><div class="mem-row"><span>Status</span><b class="mem-status-expired">EXPIRED</b></div><div class="mem-row"><span>Tugagan sana</span><b>${memDay(m.expireDate)}</b></div></div><p class="small" style="margin:10px 0 0">Muddati tugagach hisobingiz avtomatik FREE tarifga qaytarildi.</p>` : '');
  return `<div class="mem-card mem-${t.toLowerCase()}"><span class="mem-eyebrow">A'ZOLIK</span><b class="mem-plan">${esc(memText({ type: t }))}${vipBadge(m)}</b>${rows}${t === 'FREE' && m.status !== 'EXPIRED' ? `<p class="small" style="margin:10px 0 0">Hozircha FREE tarifdasiz. <span class="link" data-go="/vip">VIP imkoniyatlarini ko'ring →</span></p>` : ''}</div>`;
};

// ---- VIP "upgrade" gate: ruxsat berilmagan kontent uchun yagona joy (server javobidagi requiredPlan asosida) ----
let vipPlansCache = null;
const loadVipPlans = async () => vipPlansCache || (vipPlansCache = await api('/api/membership/plans').catch(() => ({ plans: [], durations: [], comparison: [] })));
const vipTierCard = (p, need) => `<div class="vip-tier-card vip-${p.type.toLowerCase()}${p.type === need ? ' required' : ''}">${p.type === need ? '<span class="vip-tier-flag">Kerakli tarif</span>' : ''}<span class="vip-tier-icon">${p.icon || '⭐'}</span><b>${esc(p.label)}</b><ul>${(p.ownFeatureLabels || []).slice(0, 4).map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>`;
const vipGateBlock = (plans, need, opts = {}) => `<div class="vip-gate"><span class="vip-gate-icon">🔒</span><span class="eyebrow">VIP A'ZOLIK</span><h2>Bu material VIP a'zolikni talab qiladi.</h2><p class="small">${esc(opts.note || 'Davom etish uchun quyidagi tariflardan biri kerak bo\u2018ladi.')}</p><div class="vip-gate-tiers">${plans.filter(p => p.type !== 'FREE').map(p => vipTierCard(p, need)).join('')}</div><div class="vip-gate-actions"><button class="btn" data-go="/vip">VIP haqida</button>${opts.secondary ? `<button class="btn outline" data-vip-gate-close="1">${esc(opts.secondary)}</button>` : ''}</div></div>`;
async function showVipGate(need, opts = {}) { const { plans } = await loadVipPlans(); document.querySelector('#vipGateModal')?.remove(); root.insertAdjacentHTML('beforeend', `<div class="modal" id="vipGateModal">${vipGateBlock(plans, need, { ...opts, secondary: 'Yopish' })}</div>`); const m = document.querySelector('#vipGateModal'); m.addEventListener('mousedown', e => { if (e.target === m) m.remove(); }); m.querySelector('[data-vip-gate-close]').onclick = () => m.remove(); }
async function renderVipGatePage(need, opts = {}) { const { plans } = await loadVipPlans(); root.innerHTML = `${nav()}<main class="module-page"><section class="section" style="padding-top:60px">${vipGateBlock(plans, need, { ...opts, secondary: 'Orqaga' })}</section></main>`; document.querySelector('[data-vip-gate-close]').onclick = () => history.length > 1 ? history.back() : go('/'); }

// ---- Taqqoslash jadvali: server /api/membership/plans ichidagi `comparison` dan chiziladi ----
const CMP_MARK = { full: '<span class="cmp-yes" title="Mavjud">✓</span>', limited: '<span class="cmp-partial" title="Qisman (tanlangan materiallar)">✓<small>*</small></span>', none: '<span class="cmp-no" aria-hidden="true">–</span>' };
function comparisonTableHtml(rows, types) {
  return `<div class="cmp-wrap"><table class="cmp-table"><thead><tr><th>Feature</th>${types.map(t => `<th class="cmp-${t.toLowerCase()}">${MEM_UI[t][0] ? MEM_UI[t][0] + ' ' : ''}${t}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.label)}</td>${types.map(t => `<td>${CMP_MARK[r.cells[t]] || CMP_MARK.none}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="small cmp-note">✓* — tanlangan materiallar bo'yicha qisman kirish.</p></div>`;
}

// ---- Talaba: /vip sahifasi ----
const DURATION_ICON = { '3d': '⚡', '7d': '📅', '1m': '🗓️', '1y': '🏆' };
let vipSelectedDuration = {};
async function vipPage() {
  root.innerHTML = `${nav()}<main class="module-page"><section class="module-hero vip-hero" style="grid-template-columns:1fr"><div class="module-copy"><span class="module-kicker">💎 VIP A'ZOLIK</span><h1>VIP MEMBERSHIP</h1><p>Ta'lim imkoniyatlaringizni kengaytiring</p></div></section><section class="section" id="vipPlans"><div class="grid mock-grid">Yuklanmoqda...</div></section><section class="section" id="vipCompare" style="padding-top:0"></section></main>`;
  let plans = [], durations = [], comparison = [], contact = {};
  try { ({ plans, durations, comparison, contact } = await loadVipPlans()); } catch (e) { }
  const my = me && me.membership ? me.membership.type : null;
  const durBtns = p => `<div class="vip-durations" role="group" aria-label="Muddatni tanlang">${durations.map(d => `<button type="button" class="vip-dur-btn${(vipSelectedDuration[p.type] || durations[0]?.key) === d.key ? ' selected' : ''}" data-vip-dur="${p.type}" data-dur-key="${d.key}">${DURATION_ICON[d.key] || ''} ${esc(d.label)}</button>`).join('')}</div>`;
  document.querySelector('#vipPlans').innerHTML = `<div class="grid mock-grid vip-cards">${plans.filter(p => p.type !== 'FREE').map(p => `<article class="card mock vip-card vip-${p.type.toLowerCase()}">${my === p.type ? `<span class="vip-current-flag">✓ Joriy tarifingiz</span>` : ''}<span class="tag">${p.icon} ${esc(p.label)}</span><h3>${esc(p.label)}</h3><p class="small vip-card-desc">${esc(p.description || '')}</p><ul class="small vip-feature-list">${(p.featureLabels || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul><div class="vip-duration-block"><span class="vip-duration-label">Muddat</span>${durBtns(p)}<p class="small vip-selected-note" data-vip-selected="${p.type}">Tanlangan: ${esc((durations.find(d => d.key === (vipSelectedDuration[p.type] || durations[0]?.key)) || {}).label || '')}</p></div><div class="vip-access-info">${my === p.type ? `<span class="tag">Muddati: ${memDay(me.membership.expireDate)} gacha</span>` : `<button class="btn" data-vip-request="${p.type}">Ushbu tarifni xohlayman</button>`}</div></article>`).join('')}</div>`;
  document.querySelector('#vipCompare').innerHTML = `<div class="section-head"><div><span class="eyebrow">TAQQOSLASH</span><h2>Tariflarni solishtiring</h2></div></div>${comparisonTableHtml(comparison, ['FREE', 'SILVER', 'GOLD', 'PLATINUM'])}`;
  document.querySelectorAll('[data-vip-dur]').forEach(b => b.onclick = () => {
    const type = b.dataset.vipDur; vipSelectedDuration[type] = b.dataset.durKey;
    document.querySelectorAll(`[data-vip-dur="${type}"]`).forEach(x => x.classList.toggle('selected', x === b));
    const note = document.querySelector(`[data-vip-selected="${type}"]`);
    if (note) note.textContent = 'Tanlangan: ' + (durations.find(d => d.key === b.dataset.durKey) || {}).label;
  });
  document.querySelectorAll('[data-vip-request]').forEach(b => b.onclick = () => {
    if (!me) return go('/login');
    const type = b.dataset.vipRequest, durKey = vipSelectedDuration[type] || durations[0]?.key, dur = durations.find(d => d.key === durKey);
    toast(`${MEM_UI[type][1]} · ${dur ? dur.label : ''} — so'rovingiz uchun Support markaziga murojaat qiling.`);
  });
}

// ---- Admin: tezkor faollashtirish / uzaytirish (mavjud tarif bo'lsa muddatga qo'shiladi) ----
async function vipModal(u) {
  if (!u) return;
  let cfg; try { cfg = await api('/api/membership/plans'); } catch (e) { return toast(e.message); }
  document.querySelector('#vipModal')?.remove();
  const m = u.membership || { type: 'FREE' }, active = m.type !== 'FREE';
  root.insertAdjacentHTML('beforeend', `<div class="modal" id="vipModal"><div class="vip-modal"><h2>VIP tarifni faollashtirish</h2><p class="small"><b>${esc(u.name)}</b><br>Hozirgi tarif: <b>${esc(memText(m))}</b>${active ? ` · ${memDay(m.expireDate)} gacha` : ''}</p><form id="vipForm"><div class="field"><label>VIP turi</label><select name="type">${cfg.plans.filter(p => p.type !== 'FREE').map(p => `<option value="${esc(p.type)}">${esc((p.icon ? p.icon + ' ' : '') + p.label)}</option>`).join('')}</select></div><div class="field"><label>Muddat</label><select name="duration">${cfg.durations.map(x => `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join('')}</select></div><p class="small">Boshlanish va tugash sanalari avtomatik hisoblanadi.${active ? ' Bir xil tarif tanlansa, muddat amaldagi muddatga qo\u2018shiladi.' : ''}</p><div class="actions"><button class="btn outline" type="button" id="vipClose">Yopish</button><button class="btn" type="submit" id="vipSave">Faollashtirish</button></div></form>${active ? `<p style="margin-top:14px"><span class="link" id="vipChangeLevel">Darajani o'zgartirish (muddat saqlanadi)</span> · <span class="link" id="vipRevoke">Bekor qilish</span></p>` : ''}<p style="margin-top:10px"><span class="link" id="vipHistLink">A'zolik tarixini ko'rish</span></p></div></div>`);
  const modal = document.querySelector('#vipModal'), form = modal.querySelector('#vipForm'), close = () => modal.remove(), url = `/api/admin/users/${encodeURIComponent(u.id)}/membership`;
  modal.querySelector('#vipClose').onclick = close;
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
  const send = replace => api(url, { method: 'POST', body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), replace }) });
  form.onsubmit = async e => {
    e.preventDefault(); const btn = modal.querySelector('#vipSave'); if (btn.disabled) return; btn.disabled = true;
    try {
      let r; try { r = await send(false); } catch (x) { if (x.code === 'MEMBERSHIP_ACTIVE' && confirm(x.message)) r = await send(true); else throw x; }
      toast(`${memText(r.membership)} · Active until: ${memDay(r.membership.expireDate)}`); close(); refreshVipCaller();
    } catch (x) { btn.disabled = false; if (x.code !== 'MEMBERSHIP_ACTIVE') toast(x.message); }
  };
  const rv = modal.querySelector('#vipRevoke');
  if (rv) rv.onclick = async () => { if (!confirm('Bu foydalanuvchining VIP a\u2018zoligi bekor qilinib, FREE ga qaytarilsinmi?')) return; try { await api(url, { method: 'DELETE' }); toast('VIP bekor qilindi · FREE'); close(); refreshVipCaller(); } catch (x) { toast(x.message); } };
  const cl = modal.querySelector('#vipChangeLevel');
  if (cl) cl.onclick = () => { close(); vipChangeModal(u); };
  modal.querySelector('#vipHistLink').onclick = () => { close(); vipHistoryModal(u.id, u.name); };
}

// ---- Admin: joriy tarifni almashtirish, sana o'zgarmaydi (masalan GOLD dan PLATINUM ga) ----
async function vipChangeModal(u) {
  const m = u.membership || {}, cfg = await api('/api/membership/plans').catch(() => ({ plans: [] }));
  document.querySelector('#vipModal')?.remove();
  root.insertAdjacentHTML('beforeend', `<div class="modal" id="vipModal"><div class="vip-modal"><h2>Darajani o'zgartirish</h2><p class="small"><b>${esc(u.name)}</b><br>Joriy: <b>${esc(memText(m))}</b> · ${memDay(m.expireDate)} gacha (muddat o'zgarmaydi)</p><form id="vipChangeForm"><div class="field"><label>Yangi daraja</label><select name="type">${cfg.plans.filter(p => p.type !== 'FREE' && p.type !== m.type).map(p => `<option value="${esc(p.type)}">${esc((p.icon ? p.icon + ' ' : '') + p.label)}</option>`).join('')}</select></div><div class="actions"><button class="btn outline" type="button" id="vipClose">Yopish</button><button class="btn" type="submit">Saqlash</button></div></form></div></div>`);
  const modal = document.querySelector('#vipModal'), close = () => modal.remove();
  modal.querySelector('#vipClose').onclick = close;
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
  modal.querySelector('#vipChangeForm').onsubmit = async e => {
    e.preventDefault();
    try { const b = Object.fromEntries(new FormData(e.target)); const r = await api(`/api/admin/users/${encodeURIComponent(u.id)}/membership`, { method: 'PATCH', body: JSON.stringify(b) }); toast(`Daraja o'zgartirildi: ${memText(r.membership)}`); close(); refreshVipCaller(); }
    catch (x) { toast(x.message); }
  };
}

// ---- Admin: a'zolik tarixi (bitta foydalanuvchi yoki barchasi) ----
async function vipHistoryModal(userId, userName) {
  document.querySelector('#vipHistModal')?.remove();
  root.insertAdjacentHTML('beforeend', `<div class="modal" id="vipHistModal"><div class="vip-modal vip-hist-modal"><h2>A'zolik tarixi${userName ? ' · ' + esc(userName) : ''}</h2><div id="vipHistBody" class="vip-hist-body"><p class="small">Yuklanmoqda...</p></div><div class="actions"><button class="btn outline" type="button" id="vipHistClose">Yopish</button></div></div></div>`);
  const modal = document.querySelector('#vipHistModal'), close = () => modal.remove();
  modal.querySelector('#vipHistClose').onclick = close;
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
  try {
    const { history } = await api('/api/admin/memberships/history' + (userId ? '?userId=' + encodeURIComponent(userId) : ''));
    document.querySelector('#vipHistBody').innerHTML = history.length ? `<table class="cmp-table vip-hist-table"><thead><tr><th>User</th><th>Plan</th><th>Duration</th><th>Start</th><th>Expire</th><th>Activated by</th><th>Status</th></tr></thead><tbody>${history.map(h => `<tr><td>${esc(h.userName)}</td><td>${h.icon || ''} ${esc(h.planLabel)}</td><td>${esc(h.durationLabel || h.actionLabel)}</td><td>${memDay(h.startDate)}</td><td>${memDay(h.expireDate)}</td><td>${esc(h.activatedByName)}</td><td><span class="vip-hist-status vip-hist-${h.status.toLowerCase()}">${h.status}</span></td></tr>`).join('')}</tbody></table>` : '<p class="small">Tarix hali yo\u2018q.</p>';
  } catch (x) { document.querySelector('#vipHistBody').innerHTML = `<p class="small">${esc(x.message)}</p>`; }
}

// ---- Admin: VIP Management sahifasi ----
let vipMgmtFilter = { q: '', type: '' };
let refreshVipCaller = () => { if (location.pathname === '/admin/vip') adminVip(vipMgmtFilter); else if (location.pathname === '/admin/users') adminUsers(); };
async function adminVip(filter = vipMgmtFilter) {
  vipMgmtFilter = filter;
  let data; try { data = await api('/api/admin/memberships'); } catch (e) { return toast(e.message); }
  let { users, summary } = data;
  root.innerHTML = `<div class="app-shell"><aside class="side">${logo}<nav class="menu"><a data-go="/admin">Dashboard</a><a data-go="/admin/users">Foydalanuvchilar</a><a data-go="/admin/tests">Testlar</a><a class="active" data-go="/admin/vip">💎 VIP boshqaruvi</a><a data-go="/admin/settings">Sozlamalar</a><a data-action="logout">Chiqish</a></nav></aside><main class="app-main"><div class="topline"><div><span class="eyebrow">VIP MANAGEMENT</span><h1>VIP a'zoliklar</h1><p>Faollashtiring, uzaytiring, darajasini o'zgartiring yoki bekor qiling.</p></div><button class="btn outline" id="vipHistAll">Barcha tarixni ko'rish</button></div><section class="kpis">${[['Jami', summary.total], ['Faol VIP', summary.active], ['Muddati tugagan', summary.expired], ['7 kun ichida tugaydi', summary.expiringSoon]].map(x => `<div class="kpi"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')}</section><div class="table-card" style="margin-top:18px"><div class="vip-mgmt-filters"><input placeholder="Ism yoki email bo'yicha qidirish..." id="vipFind" value="${esc(filter.q || '')}"><select id="vipTypeFilter"><option value="">Barcha turlar</option><option value="FREE"${filter.type === 'FREE' ? ' selected' : ''}>FREE</option><option value="SILVER"${filter.type === 'SILVER' ? ' selected' : ''}>🥈 SILVER</option><option value="GOLD"${filter.type === 'GOLD' ? ' selected' : ''}>🥇 GOLD</option><option value="PLATINUM"${filter.type === 'PLATINUM' ? ' selected' : ''}>💎 PLATINUM</option></select></div><div id="vipMgmtList"></div></div></main></div>`;
  const draw = () => {
    const q = (document.querySelector('#vipFind').value || '').toLowerCase(), ty = document.querySelector('#vipTypeFilter').value;
    const list = users.filter(u => (!ty || u.membership.type === ty) && (!q || (u.name + u.email).toLowerCase().includes(q)));
    document.querySelector('#vipMgmtList').innerHTML = list.length ? list.map(u => `<div class="list-row vip-mgmt-row"><div><b>${esc(u.name)}${vipBadge(u.membership)}</b><span>${esc(u.email)} · ${u.role}</span></div><div class="vip-mgmt-status"><span class="mem-tag mem-${u.membership.type.toLowerCase()}">${esc(memText(u.membership))}</span>${u.membership.active ? `<span class="small">${memDay(u.membership.expireDate)} gacha · ${u.membership.daysLeft} kun qoldi</span>` : (u.membership.status === 'EXPIRED' ? `<span class="small mem-status-expired">Tugagan</span>` : '')}</div><div class="vip-mgmt-actions"><button class="btn light" data-vip-act="${esc(u.id)}">${u.membership.active ? 'Uzaytirish' : 'Faollashtirish'}</button><button class="btn outline" data-vip-hist="${esc(u.id)}" data-vip-hist-name="${esc(u.name)}">Tarix</button></div></div>`).join('') : '<p class="small" style="padding:16px 0">Hech kim topilmadi.</p>';
    document.querySelectorAll('[data-vip-act]').forEach(b => b.onclick = () => vipModal(users.find(x => x.id === b.dataset.vipAct)));
    document.querySelectorAll('[data-vip-hist]').forEach(b => b.onclick = () => vipHistoryModal(b.dataset.vipHist, b.dataset.vipHistName));
  };
  document.querySelector('#vipFind').oninput = () => { vipMgmtFilter.q = document.querySelector('#vipFind').value; draw(); };
  document.querySelector('#vipTypeFilter').onchange = () => { vipMgmtFilter.type = document.querySelector('#vipTypeFilter').value; draw(); };
  document.querySelector('#vipHistAll').onclick = () => vipHistoryModal(null, null);
  draw();
}
