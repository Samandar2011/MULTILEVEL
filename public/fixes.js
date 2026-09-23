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
  });
  observer.observe(document.querySelector('#app'), {childList: true, subtree: true});
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-theme-toggle]');
    if (button) toggleTheme();
  });
  addThemeToggle();
  fixExam();
})();
