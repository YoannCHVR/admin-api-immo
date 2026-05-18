// Gestionnaire Real Estate — helpers communs (config, fetch admin, toast)

const STORAGE_KEY = 'gre_config';

function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

function getApiUrl() {
  const url = (loadConfig().apiUrl || 'http://localhost:8000').trim();
  return url.replace(/\/+$/, '');
}

function getAdminToken() {
  return (loadConfig().adminToken || '').trim();
}

async function fetchAdmin(path, opts = {}) {
  const token = getAdminToken();
  if (!token) {
    throw new Error('Token admin manquant — renseigne-le dans la barre de config');
  }
  const res = await fetch(getApiUrl() + path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      'X-Admin-Token': token,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
  }
  return res.json();
}

function toast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
