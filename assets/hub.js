// Hub — Stonks Design System — navigation + stats live

(() => {
  const $ = (id) => document.getElementById(id);
  let statsInterval = null;

  // ---------- Config bar ----------

  function initConfig() {
    const cfg = loadConfig();
    $('apiUrl').value = cfg.apiUrl || 'http://localhost:8000';
    $('adminToken').value = cfg.adminToken || '';
    $('outilUrl').value = cfg.outilUrl || 'http://localhost:3005';

    $('saveConfig').addEventListener('click', () => {
      saveConfig({
        apiUrl: $('apiUrl').value.trim(),
        adminToken: $('adminToken').value.trim(),
        outilUrl: $('outilUrl').value.trim(),
      });
      toast('Configuration sauvée', 'success');
      refreshAll();
    });
  }

  // ---------- Health ping with latency ----------

  async function pingHealth() {
    const dot = $('healthDot');
    const text = $('healthText');
    dot.className = 'hub-health-dot pending';
    try {
      const t0 = performance.now();
      const res = await fetch(getApiUrl() + '/health');
      const ms = Math.round(performance.now() - t0);
      if (res.ok) {
        dot.className = 'hub-health-dot ok';
        text.textContent = `API healthy · ${ms}ms`;
      } else {
        dot.className = 'hub-health-dot ko';
        text.textContent = 'Erreur API';
      }
      return res.ok;
    } catch {
      dot.className = 'hub-health-dot ko';
      text.textContent = 'Injoignable';
      return false;
    }
  }

  // ---------- Tiles ----------

  function updateTiles() {
    const apiUrl = getApiUrl();
    const cfg = loadConfig();
    const outilUrl = cfg.outilUrl || 'http://localhost:3005';
    const hasToken = !!getAdminToken();

    $('tileApi').href = apiUrl + '/docs';
    $('tileOutil').href = outilUrl;

    const adminTile = $('tileAdmin');
    const adminTools = $('adminTools');
    const warning = $('tokenWarning');

    if (hasToken) {
      adminTile.classList.remove('tile-disabled');
      adminTools.classList.remove('hidden');
      warning.hidden = true;
    } else {
      adminTile.classList.add('tile-disabled');
      adminTools.classList.add('hidden');
      warning.hidden = false;
    }
  }

  function wireAdminToggle() {
    const tile = $('tileAdmin');
    const tools = $('adminTools');
    const arrow = $('adminExpand');

    tile.addEventListener('click', () => {
      if (tile.classList.contains('tile-disabled')) return;
      const open = tools.classList.toggle('expanded');
      arrow.textContent = open ? '\u25B2' : '\u25BC';
    });

    if (getAdminToken()) {
      tools.classList.add('expanded');
      arrow.textContent = '\u25B2';
    }
  }

  // ---------- Stats live ----------

  async function loadStats() {
    if (!getAdminToken()) { clearStats(); return; }
    try {
      const data = await fetchAdmin('/admin/agencies/stats');
      renderStats(data);
    } catch { clearStats(); }
  }

  function renderStats(data) {
    $('statTotal').textContent = fmt(data.total);
    $('statPending').textContent = fmt(data.by_status?.pending || 0);
    $('statToScrape').textContent = fmt(data.by_status?.to_scrape || 0);
    $('statScraped').textContent = fmt(data.by_status?.scraped || 0);
    $('statSkip').textContent = fmt(data.by_status?.skip || 0);
    $('statClosed').textContent = fmt(data.by_status?.closed || 0);
    $('statWebsite').textContent = fmt(data.with_website || 0);
    $('statNoWebsite').textContent = fmt(data.without_website || 0);

    const srcEl = $('statsSources');
    if (data.by_source && Object.keys(data.by_source).length) {
      const items = Object.entries(data.by_source).sort((a, b) => b[1] - a[1]);
      srcEl.innerHTML =
        '<div class="hub-section-title">Par source</div><div class="hub-source-pills">' +
        items.map(([s, c]) => `<span class="hub-source-pill"><strong>${escapeHtml(s)}</strong> ${fmt(c)}</span>`).join('') +
        '</div>';
    } else { srcEl.innerHTML = ''; }

    const citiesEl = $('statsCities');
    if (data.by_city_top && data.by_city_top.length) {
      citiesEl.innerHTML =
        '<div class="hub-section-title">Top villes</div><div class="hub-source-pills">' +
        data.by_city_top.map(c => `<span class="hub-source-pill"><strong>${escapeHtml(c.city)}</strong> ${fmt(c.count)}</span>`).join('') +
        '</div>';
    } else { citiesEl.innerHTML = ''; }

    $('statsUpdated').textContent = `Mis à jour il y a ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }

  function clearStats() {
    ['statTotal', 'statPending', 'statToScrape', 'statScraped', 'statSkip', 'statClosed', 'statWebsite', 'statNoWebsite']
      .forEach(id => { $(id).textContent = '–'; });
    $('statsSources').innerHTML = '';
    $('statsCities').innerHTML = '';
    $('statsUpdated').textContent = '';
  }

  function fmt(n) { return Number(n).toLocaleString('fr-FR'); }

  // ---------- Auto-refresh ----------

  function startAutoRefresh() {
    if (statsInterval) clearInterval(statsInterval);
    statsInterval = setInterval(() => {
      if (!document.hidden) { loadStats(); pingHealth(); }
    }, 60_000);
  }

  function refreshAll() { pingHealth(); updateTiles(); loadStats(); }

  // ---------- Init ----------

  initConfig();
  wireAdminToggle();
  refreshAll();
  startAutoRefresh();
})();
