(() => {
  const originalFetch = window.fetch.bind(window);
  const themeKey = 'cefr-theme';

  const readTheme = () => localStorage.getItem(themeKey) || 'light';
  const applyTheme = () => document.documentElement.dataset.theme = readTheme();
  const toggleTheme = () => {
    const next = readTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(themeKey, next);
    applyTheme();
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.textContent = next === 'dark' ? '☀️' : '🌙';
      button.setAttribute('aria-label', next === 'dark' ? 'Yorug‘ rejim' : 'Qorong‘i rejim');
      button.title = next === 'dark' ? 'Yorug‘ rejim' : 'Qorong‘i rejim';
    });
  };

  const addThemeToggle = () => {
    const target = document.querySelector('.side') || document.querySelector('.exam-top') || document.querySelector('.topline') || document.querySelector('.nav');
    document.querySelectorAll('[data-theme-toggle]').forEach(button => { if (button.parentElement !== target) button.remove(); });
    if (target && !target.querySelector('[data-theme-toggle]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-toggle';
      button.dataset.themeToggle = 'true';
      target.appendChild(button);
    }
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.textContent = readTheme() === 'dark' ? '☀️' : '🌙';
    });
  };

  const fixExam = () => {
    const questionGrid = document.querySelector('.q-grid');
    const finish = document.querySelector('#finish');
    if (!finish || !questionGrid) return;
    window.currentQuestionTotal = questionGrid.querySelectorAll('button').length;
    if (finish.dataset.guardInstalled) return;
    finish.dataset.guardInstalled = 'true';
    finish.addEventListener('click', () => {
      finish.disabled = true;
      window.setTimeout(() => { if (!window.__submitting) finish.disabled = false; }, 700);
    }, true);
  };

  let lastSideEl = null;
  const closeSideDrawer = () => document.body.classList.remove('side-open');
  const addSideToggle = () => {
    const side = document.querySelector('.side');
    if (!side) {
      document.querySelector('.side-toggle')?.remove();
      document.querySelector('.side-backdrop')?.remove();
      closeSideDrawer();
      lastSideEl = null;
      return;
    }
    if (side !== lastSideEl) {
      // Sahifa almashdi (SPA root.innerHTML qayta chizildi) — drawer ochiq qolib ketmasin.
      closeSideDrawer();
      lastSideEl = side;
    }
    if (!document.querySelector('.side-toggle')) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'side-toggle';
      toggle.setAttribute('aria-label', 'Menyu');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span></span><span></span><span></span>';
      toggle.onclick = () => {
        const open = document.body.classList.toggle('side-open');
        toggle.setAttribute('aria-expanded', String(open));
      };
      document.body.appendChild(toggle);
    }
    if (!document.querySelector('.side-backdrop')) {
      const backdrop = document.createElement('div');
      backdrop.className = 'side-backdrop';
      backdrop.onclick = closeSideDrawer;
      document.body.appendChild(backdrop);
    }
    if (!side.querySelector('.side-close')) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'side-close';
      close.setAttribute('aria-label', 'Yopish');
      close.textContent = '×';
      close.onclick = closeSideDrawer;
      side.insertBefore(close, side.firstChild);
    }
    side.querySelectorAll('.menu a').forEach(a => {
      if (a.dataset.drawerBound) return;
      a.dataset.drawerBound = 'true';
      a.addEventListener('click', closeSideDrawer);
    });
  };

  const showUploadState = () => {
    const status = document.querySelector('#recordStatus');
    if (status) {
      status.textContent = 'Yuklanmoqda...';
      status.className = 'small upload-status is-uploading';
    }
  };

  const showRuntimeError = message => {
    const app = document.querySelector('#app');
    if (!app || app.dataset.runtimeError) return;
    app.dataset.runtimeError = 'true';
    app.innerHTML = `<main class="runtime-error"><h1>Sahifa yuklanmadi</h1><p>${message}</p><button class="btn" type="button" onclick="location.reload()">Qayta yuklash</button></main>`;
  };

  window.fetch = async (input, options = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url && /\/api\/attempts\/[^/]+\/audio$/.test(url) && typeof options.body === 'string') {
      try {
        const payload = JSON.parse(options.body);
        payload.mime = String(payload.mime || 'audio/webm').split(';')[0];
        options.body = JSON.stringify(payload);
        showUploadState();
      } catch {}
    }
    const response = await originalFetch(input, options);
    if (url && url.endsWith('/api/admin/reviews') && response.ok) {
      try {
        const data = await response.clone().json();
        const groups = new Map();
        (data.submissions || []).forEach(row => {
          const key = [row.attempt?.id, row.student?.id, row.test?.id, row.question?.type].join('|');
          if (!groups.has(key)) groups.set(key, {...row, groupedCount: 1});
          else groups.get(key).groupedCount += 1;
        });
        return new Response(JSON.stringify({submissions: [...groups.values()]}), {status: response.status, headers: response.headers});
      } catch {}
    }
    return response;
  };

  applyTheme();
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('[data-go]') : null;
    if (!target || !target.dataset.go) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    history.pushState({}, '', target.dataset.go);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, true);
  window.addEventListener('error', event => showRuntimeError(`JavaScript xatosi: ${event.message || 'Noma’lum xato'}`));
  window.addEventListener('unhandledrejection', event => showRuntimeError(`Server yoki JavaScript xatosi: ${event.reason?.message || event.reason || 'Noma’lum xato'}`));
  window.setTimeout(() => {
    const app = document.querySelector('#app');
    if (app && /Yuklanmoqda|skeleton-card/.test(app.textContent || '') && !app.querySelector('.hero, .module-page, .exam, .auth-wrap, .app-shell')) {
      showRuntimeError('Server javob bermadi yoki Chrome eski sahifani ochdi.');
    }
  }, 8000);
  const observer = new MutationObserver(() => {
    addThemeToggle();
    fixExam();
    addSideToggle();
  });
  observer.observe(document.querySelector('#app'), {childList: true, subtree: true});
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-theme-toggle]');
    if (button) toggleTheme();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSideDrawer(); });
  addThemeToggle();
  fixExam();
  addSideToggle();
})();
