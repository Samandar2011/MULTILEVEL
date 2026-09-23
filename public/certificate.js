/* certificate.js — Multilevel DEMO sertifikat (Part 5/5)
   - Shablon: /assets/certificate-template.jpg (yuklangan sertifikat rasmi). Faqat bo'sh maydonlar to'ldiriladi.
   - Barcha qiymatlar serverdan: GET /api/submissions/:id/certificate (hisob + mavjud natija). Hech narsa qo'lda yozilmagan.
   - Ko'rinish (preview) va PDF BITTA chizish funksiyasidan chiqadi, shuning uchun ikkalasi bir xil.
   - PDF tashqi kutubxonasiz yig'iladi (bitta sahifa, sahifa nisbati shablon nisbatiga teng). */
(() => {
  'use strict';

  const TEMPLATE_URL = '/assets/certificate-template.jpg';
  // Shablon piksel to'ri (1061 x 1483). Koordinatalar shu to'rga nisbatan; boshqa o'lchamdagi shablon qo'yilsa ham
  // chizish avtomatik masshtablanadi (asosiysi — nisbat o'zgarmasin).
  const W = 1061, H = 1483;
  const INK = '#18213d', RED = '#9b2c22';
  const SERIF = 'Georgia, "Times New Roman", "Noto Serif", "DejaVu Serif", serif';
  const SANS = '"DM Sans", "Segoe UI", Arial, Helvetica, sans-serif';

  // Shablondagi bo'sh qutilar [x0, y0, x1, y1]
  const BOX = {
    ref: [581, 561, 951, 598],
    lang: [308, 918, 514, 963],
    level: [812, 917, 952, 963],
    listening: [435, 1036, 498, 1091],
    reading: [638, 1036, 701, 1092],
    overall: [892, 1036, 955, 1093],
    writing: [435, 1142, 498, 1200],
    speaking: [638, 1143, 701, 1201]
  };

  const formatScore = v => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  };
  const formatDate = iso => {
    const t = new Date(iso);
    if (!iso || isNaN(t)) return '—';
    // Bir xil sana har qanday qurilmada: Toshkent vaqti bo'yicha DD.MM.YYYY
    return t.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Tashkent' }).replace(/\//g, '.');
  };
  const safeName = v => String(v || '').replace(/[^A-Za-z0-9_-]/g, '');

  // Matnni berilgan kenglikka sig'diradi (shrift kichraytiriladi)
  function fit(ctx, text, maxW, size, weight, family, min = 11) {
    let s = size;
    ctx.font = `${weight} ${s}px ${family}`;
    while (s > min && ctx.measureText(text).width > maxW) { s -= 1; ctx.font = `${weight} ${s}px ${family}`; }
    return s;
  }
  function centerIn(ctx, box, text, size, weight, family = SERIF) {
    const [x0, y0, x1, y1] = box;
    fit(ctx, text, x1 - x0 - 10, size, weight, family);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, (x0 + x1) / 2, (y0 + y1) / 2 + 1);
  }

  /* Sertifikatni chizadi. ctx: 2D kontekst, img: yuklangan shablon, data: serverdan kelgan certificate obyekti,
     scale: canvas kengligi / W. */
  function draw(ctx, img, data, scale) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, W, H);

    // 1) Diagonal "DEMO — UNOFFICIAL" suv belgisi (ma'lumotlar ostida, doimo ko'rinadi)
    ctx.save();
    ctx.translate(W / 2, H * 0.53); ctx.rotate(-Math.PI / 6);
    ctx.fillStyle = 'rgba(155,44,34,0.12)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fit(ctx, 'DEMO — UNOFFICIAL', 880, 120, 800, SANS, 40);
    ctx.fillText('DEMO — UNOFFICIAL', 0, 0);
    ctx.restore();

    // 2) Yuqoridagi belgi
    ctx.save();
    const label = 'DEMO — UNOFFICIAL';
    ctx.font = `700 21px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lw = ctx.measureText(label).width + 44, lx = W / 2 - lw / 2, ly = 96, lh = 40;
    ctx.fillStyle = 'rgba(255,250,245,0.92)'; ctx.strokeStyle = RED; ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(lx, ly, lw, lh, 8); else ctx.rect(lx, ly, lw, lh);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = RED; ctx.fillText(label, W / 2, ly + lh / 2 + 1);
    ctx.restore();

    // 3) Ma'lumotlar (hammasi data dan)
    ctx.fillStyle = INK;
    centerIn(ctx, BOX.ref, String(data.referenceNumber || '—'), 25, 700);

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const nameMax = 800 - 380; // rasm qutisigacha
    fit(ctx, data.surname || '—', nameMax, 30, 700, SERIF); ctx.fillText(data.surname || '—', 380, 732);
    fit(ctx, data.firstName || '—', nameMax, 30, 700, SERIF); ctx.fillText(data.firstName || '—', 380, 811);

    centerIn(ctx, BOX.lang, data.foreignLanguage || '—', 25, 700);
    centerIn(ctx, BOX.level, data.level || '—', 32, 800);

    const sc = data.scores || {};
    centerIn(ctx, BOX.listening, formatScore(sc.listening), 27, 700);
    centerIn(ctx, BOX.reading, formatScore(sc.reading), 27, 700);
    centerIn(ctx, BOX.writing, formatScore(sc.writing), 27, 700);
    centerIn(ctx, BOX.speaking, formatScore(sc.speaking), 27, 700);
    centerIn(ctx, BOX.overall, formatScore(sc.overall), 27, 800);

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = `700 26px ${SERIF}`;
    ctx.fillText(formatDate(data.issuedAt), 272, 1307);

    // 4) Pastdagi ogohlantirish
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = RED; ctx.font = `700 19px ${SANS}`;
    ctx.fillText('DEMO — UNOFFICIAL · Motivatsion namuna, rasmiy hujjat emas', W / 2, 1352);
    ctx.fillStyle = '#5b5a52'; ctx.font = `500 16px ${SANS}`;
    ctx.fillText('Demo / motivational certificate only. Not an official document of any authority.', W / 2, 1378);
  }

  /* ---------- Minimal PDF (bitta sahifa, bitta JPEG) ---------- */
  function buildPdf(jpeg, iw, ih, pw, ph, title) {
    const enc = new TextEncoder(), chunks = [], offsets = [];
    let len = 0;
    const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
    const obj = (n, bodyText) => { offsets[n] = len; push(`${n} 0 obj\n${bodyText}\nendobj\n`); };
    const esc = t => String(t).replace(/[^\x20-\x7E]/g, '').replace(/([()\\])/g, '\\$1');
    const f = n => n.toFixed(2);
    push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
    const content = `q ${f(pw)} 0 0 ${f(ph)} 0 0 cm /Im0 Do Q`;
    obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offsets[5] = len;
    push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg); push('\nendstream\nendobj\n');
    obj(6, `<< /Title (${esc(title)}) /Subject (DEMO - UNOFFICIAL certificate) /Producer (CEFR MASTER) >>`);
    const xref = len;
    let x = 'xref\n0 7\n0000000000 65535 f \n';
    for (let i = 1; i <= 6; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    push(x + `trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const out = new Uint8Array(len); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  const api = { W, H, BOX, draw, buildPdf, formatScore, formatDate };
  if (typeof document === 'undefined') { if (typeof module !== 'undefined') module.exports = api; return; }

  /* ---------- Brauzer qismi ---------- */
  let templatePromise = null;
  const loadTemplate = () => templatePromise || (templatePromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { templatePromise = null; reject(new Error('Sertifikat shabloni yuklanmadi')); };
    img.src = TEMPLATE_URL;
  }));

  const say = msg => (typeof toast === 'function' ? toast(msg) : alert(msg));

  async function fetchCertificate(submissionId) {
    const token = localStorage.getItem('token') || '';
    const res = await fetch(`/api/submissions/${encodeURIComponent(submissionId)}/certificate`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    let body = {};
    try { body = await res.json(); } catch (e) { /* bo'sh javob */ }
    if (!res.ok) throw new Error(body.error || 'Sertifikatni yuklab bo‘lmadi');
    return body.certificate;
  }

  async function render(data, scale) {
    const img = await loadTemplate();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    draw(canvas.getContext('2d'), img, data, canvas.width / W);
    return canvas;
  }

  const toBlob = (canvas, type, q) => new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Rasm yaratilmadi'))), type, q));

  async function makePdfBlob(data) {
    const canvas = await render(data, 2.4); // ~2550 x 3560 px: A4 da ~300 dpi ga yaqin matn aniqligi
    const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.94)).arrayBuffer());
    const pw = 595.28, ph = pw * H / W; // sahifa nisbati shablon nisbatiga teng
    return new Blob([buildPdf(jpeg, canvas.width, canvas.height, pw, ph, `CEFR MASTER Demo Certificate ${data.referenceNumber}`)], { type: 'application/pdf' });
  }

  async function download(submissionId, btn) {
    const old = btn && btn.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>PDF tayyorlanmoqda...'; }
    try {
      const data = await fetchCertificate(submissionId);
      const blob = await makePdfBlob(data);
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `CEFR-MASTER-Demo-Certificate-${safeName(data.referenceNumber) || 'result'}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { say(e.message || 'PDF yaratilmadi'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
  }

  function closeViewer() {
    document.querySelector('#certOverlay')?.remove();
    document.body.classList.remove('cert-lock');
  }

  async function view(submissionId, btn) {
    const old = btn && btn.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Yuklanmoqda...'; }
    try {
      const data = await fetchCertificate(submissionId);
      const canvas = await render(data, Math.min(2, Math.max(1.25, window.devicePixelRatio || 1)));
      closeViewer();
      const sc = data.scores || {};
      canvas.className = 'cert-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Demo sertifikat: ${data.surname || ''} ${data.firstName || ''}, daraja ${data.level}, umumiy ball ${formatScore(sc.overall)}. DEMO — UNOFFICIAL.`);
      const overlay = document.createElement('div');
      overlay.id = 'certOverlay'; overlay.className = 'cert-overlay';
      overlay.innerHTML = `<div class="cert-dialog" role="dialog" aria-modal="true" aria-label="Demo sertifikat">
        <div class="cert-dialog-head"><div><span class="eyebrow">DEMO — UNOFFICIAL</span><h2>Demo sertifikat</h2></div><div class="cert-head-actions"><button class="btn cert-head-dl" type="button" data-cert-download-modal="${submissionId.replace(/"/g, '')}">DOWNLOAD DEMO CERTIFICATE</button><button class="cert-x" type="button" aria-label="Yopish" data-cert-close>×</button></div></div>
        <div class="cert-stage"></div>
        <p class="small cert-note">Bu faqat demo / motivatsion namuna. U rasmiy hujjat emas va hech qanday davlat, universitet, imtihon yoki CEFR organi tomonidan berilmagan.</p>
        <div class="cert-actions"><button class="btn" type="button" data-cert-download-modal="${submissionId.replace(/"/g, '')}">DOWNLOAD DEMO CERTIFICATE</button><button class="btn outline" type="button" data-cert-close>Yopish</button></div></div>`;
      overlay.querySelector('.cert-stage').appendChild(canvas);
      document.body.appendChild(overlay);
      document.body.classList.add('cert-lock');
      overlay.querySelector('[data-cert-close]').focus();
    } catch (e) { say(e.message || 'Sertifikat ochilmadi'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
  }

  document.addEventListener('click', e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    let el;
    if ((el = t.closest('[data-cert-view]'))) { e.preventDefault(); view(el.dataset.certView, el); return; }
    if ((el = t.closest('[data-cert-download]'))) { e.preventDefault(); download(el.dataset.certDownload, el); return; }
    if ((el = t.closest('[data-cert-download-modal]'))) { e.preventDefault(); download(el.dataset.certDownloadModal, el); return; }
    if (t.closest('[data-cert-close]') || t.id === 'certOverlay') closeViewer();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeViewer(); });
  window.addEventListener('popstate', closeViewer);

  window.CefrCertificate = { view, download };
})();
