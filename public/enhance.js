/* Adds the contextual action after SPA pages are rendered. */
(() => {
  const supportModal = () => {
    if (document.querySelector('#supportModal')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal" id="supportModal"><div class="support-modal"><button class="support-close" type="button" aria-label="Yopish">×</button><span class="eyebrow">SUPPORT MARKAZI</span><h2>Yordam kerakmi?</h2><p class="small">Murojaatingizni yuboring yoki Telegram orqali bog‘laning: <a href="https://t.me/onlytowinn" target="_blank" rel="noreferrer">@onlytowinn</a></p><form id="supportForm"><div class="field"><label>Ismingiz</label><input name="name" required minlength="2"></div><div class="field"><label>Email yoki telefon</label><input name="contact" required minlength="3"></div><div class="field"><label>Murojaat</label><textarea name="message" required minlength="10" rows="5"></textarea></div><button class="btn" type="submit">Murojaatni yuborish</button></form></div></div>`);
    document.querySelector('.support-close').onclick = () => document.querySelector('#supportModal').remove();
    document.querySelector('#supportForm').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; try { await fetch('/api/support/tickets', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(form)))}); form.innerHTML = '<p class="support-success">Murojaatingiz qabul qilindi. Tez orada javob beramiz.</p>'; } catch { form.insertAdjacentHTML('beforeend', '<p class="small">Yuborishda xatolik yuz berdi.</p>'); } };
  };

  const adminSupport = async () => {
    const token = localStorage.token || '';
    try { const response = await fetch('/api/admin/support', {headers:{Authorization:`Bearer ${token}`}}); const data = await response.json(); if (!response.ok) throw Error(data.error); const rows = data.tickets.map(ticket => `<div class="list-row"><div><b>${ticket.name}</b><span>${ticket.contact} · ${new Date(ticket.createdAt).toLocaleString('uz-UZ')}<br>${ticket.message}</span></div><select data-ticket="${ticket.id}"><option ${ticket.status==='open'?'selected':''} value="open">Yangi</option><option ${ticket.status==='in_progress'?'selected':''} value="in_progress">Jarayonda</option><option ${ticket.status==='resolved'?'selected':''} value="resolved">Yopilgan</option></select></div>`).join(''); document.querySelector('#app').innerHTML = `<div class="app-shell"><aside class="side">${logo}<nav class="menu"><a data-go="/admin">Dashboard</a><a data-go="/admin/users">Foydalanuvchilar</a><a data-go="/admin/tests">Testlar</a><a class="active" data-support-admin>Support Inbox</a><a data-go="/admin/reviews">Topshirilgan testlar</a><a data-go="/admin/settings">Sozlamalar</a></nav></aside><main class="app-main"><div class="topline"><div><span class="eyebrow">SUPPORT</span><h1>Murojaatlar</h1><p>Telegram: @onlytowinn</p></div></div><div class="table-card">${rows || '<p class="small">Hozircha murojaatlar yo‘q.</p>'}</div></main></div>`; document.querySelectorAll('[data-ticket]').forEach(select => select.onchange = async () => { await fetch(`/api/admin/support/${select.dataset.ticket}`, {method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({status:select.value})}); }); } catch (error) { toast(error.message || 'Support inbox ochilmadi'); }
  };

  const addListeningAudio = () => {
    document.querySelectorAll('.passage').forEach(passage => { if (!passage.textContent.includes('Listening material') || passage.querySelector('.tts-audio')) return; const transcript = passage.querySelector('.small')?.textContent || ''; const button = document.createElement('button'); button.className = 'btn light tts-audio'; button.type = 'button'; button.textContent = '▶ Audio ni eshiting'; button.onclick = () => { if (!('speechSynthesis' in window)) return toast('Brauzer audio funksiyasini qo‘llamaydi'); speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(transcript.replace(/^Audio transcript:\s*/i, '')); utterance.lang = 'en-US'; utterance.rate = .88; speechSynthesis.speak(utterance); button.textContent = '■ Audio ijro etilmoqda'; utterance.onend = () => { button.textContent = '▶ Audio ni eshiting'; }; }; passage.classList.add('listening-material-block'); passage.style.display = 'flex'; passage.style.flexDirection = 'column'; passage.style.alignItems = 'flex-start'; passage.style.gap = '12px'; const small = passage.querySelector('.small'); if (small) { small.style.display = 'block'; small.style.width = '100%'; small.style.margin = '0'; } button.style.alignSelf = 'flex-start'; button.style.width = 'auto'; button.style.maxWidth = '100%'; button.style.marginTop = '0'; passage.appendChild(button); });
  };

  const addRoleControls = () => {
    if (location.pathname !== '/admin/users') return;
    document.querySelectorAll('[data-status]').forEach(button => { const row = button.closest('.user'); if (!row || row.querySelector('[data-role]')) return; const tag = row.querySelector('.tag'); const current = tag?.textContent.trim() || 'student'; const select = document.createElement('select'); select.dataset.role = button.dataset.status; select.innerHTML = ['student','moderator','examiner','admin','super_admin'].map(role => `<option value="${role}" ${role===current?'selected':''}>${role}</option>`).join(''); select.onchange = async () => { const response = await fetch(`/api/admin/users/${select.dataset.role}/role`, {method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.token||''}`},body:JSON.stringify({role:select.value})}); if (!response.ok) { toast((await response.json()).error || 'Rol yangilanmadi'); return; } toast('Huquq yangilandi'); }; button.parentElement.insertBefore(select, button); });
  };

  const enhanceAdminCatalog = async () => {
    if (location.pathname !== '/admin/tests') return;
    const card = document.querySelector('.app-main .table-card');
    if (!card || card.dataset.catalogEnhanced) return;
    const response = await fetch('/api/tests', {headers:{Authorization:`Bearer ${localStorage.token||''}`} });
    if (!response.ok) return;
    const data = await response.json();
    const tests = data.tests || [];
    const counts = tests.reduce((summary, test) => { summary[test.category] = (summary[test.category] || 0) + 1; return summary; }, {});
    const totalQuestions = tests.reduce((sum, test) => sum + Number(test.questionCount || 0), 0);
    const toolbar = document.createElement('div');
    toolbar.className = 'catalog-toolbar';
    toolbar.innerHTML = `<div><b>${tests.length} ta test</b><span>${totalQuestions} ta savol bazada</span></div><div class="catalog-filters"><button class="active" data-catalog-filter="all">Barchasi</button>${Object.keys(counts).map(category => `<button data-catalog-filter="${category}">${category} (${counts[category]})</button>`).join('')}</div>`;
    card.before(toolbar);
    card.dataset.catalogEnhanced = 'true';
    const rows = [...card.querySelectorAll('.list-row')];
    rows.forEach(row => { const title = row.querySelector('b')?.textContent.trim(); const test = tests.find(item => item.title === title); if (!test) return; const details = row.querySelector('span'); if (details) details.textContent = `${test.category} · ${test.questionCount || 0} ta savol · ${test.duration} daq · ${test.modules.join(', ')} · ${test.status}`; row.dataset.category = test.category; });
    toolbar.querySelectorAll('[data-catalog-filter]').forEach(button => button.onclick = () => { toolbar.querySelectorAll('button').forEach(item => item.classList.remove('active')); button.classList.add('active'); rows.forEach(row => { row.style.display = button.dataset.catalogFilter === 'all' || row.dataset.category === button.dataset.catalogFilter ? 'flex' : 'none'; }); });
  };

  const enhanceStudentCatalog = async () => {
    if (!document.querySelector('.test-stream')) return;
    const response = await fetch('/api/tests');
    if (!response.ok) return;
    const tests = (await response.json()).tests || [];
    document.querySelectorAll('.study-test').forEach(row => { const title = row.querySelector('h3')?.textContent.trim(); const test = tests.find(item => item.title === title); if (!test || row.querySelector('.test-metadata')) return; const metadata = document.createElement('small'); metadata.className = 'test-metadata'; metadata.textContent = `${test.questionCount || 0} ta savol · ${test.duration} daqiqa`; row.querySelector('.test-info')?.appendChild(metadata); });
  };

  document.addEventListener('click', event => { if (event.target.closest('[data-support]')) { event.preventDefault(); supportModal(); } if (event.target.closest('[data-support-admin]')) { event.preventDefault(); adminSupport(); } }, true);

  const addExamCta = () => {
    const note = document.querySelector('.module-note');
    if (!note || document.querySelector('#examCta')) return;
    const button = document.createElement('button');
    button.id = 'examCta';
    button.className = 'hero-cta';
    button.innerHTML = '<span>✦</span> CEFR sinov tajribasini boshlash <span>→</span>';
    button.addEventListener('click', () => {
      const isMultiLevel = location.pathname === '/multilevel';
      history.pushState({}, '', isMultiLevel ? '/exam/ml-01' : location.pathname);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    note.insertAdjacentElement('afterend', button);
  };
  const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      entry.target.querySelectorAll('.section-head .eyebrow, .module-kicker, .learning-path > span, .hero > div:first-child > .eyebrow, .topline .eyebrow').forEach(label => label.classList.add('label-write'));
      entry.target.querySelectorAll('.module-copy > h1, .module-copy > p, .hero > div:first-child > h1, .hero > div:first-child > p').forEach(copy => copy.classList.add('copy-write'));
      revealObserver.unobserve(entry.target);
    });
  }, {threshold: .14, rootMargin: '0px 0px -8% 0px'}) : null;

  const scanScrollReveal = () => {
    document.querySelectorAll('#app > main > section, #app > .module-page > *, #app .app-main > .topline, #app .app-main > .kpis, #app .app-main > .columns, #app .app-main > .table-card').forEach(element => {
      if (element.classList.contains('scroll-reveal')) return;
      element.classList.add('scroll-reveal');
      if (revealObserver) revealObserver.observe(element);
      else element.classList.add('is-visible');
    });
  };

  const refreshEnhancements = () => {
    addExamCta();
    scanScrollReveal();
    addListeningAudio();
    addRoleControls();
    enhanceAdminCatalog().catch(() => {});
    enhanceStudentCatalog().catch(() => {});
    document.querySelectorAll('.footer').forEach(footer => { if (!footer.querySelector('[data-support]')) footer.insertAdjacentHTML('beforeend', '<button class="btn light" data-support>Support markazi</button>'); });
    document.querySelectorAll('.side .menu').forEach(menu => { if (location.pathname.startsWith('/admin') && !menu.querySelector('[data-support-admin]')) menu.insertAdjacentHTML('beforeend', '<a data-support-admin>Support Inbox</a>'); });
  };

  new MutationObserver(refreshEnhancements).observe(document.querySelector('#app'), {childList:true, subtree:true});
  refreshEnhancements();
})();
