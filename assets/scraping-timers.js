// Timers de scraping par source — avec gestion des défauts par tier
// NOTE: L'API stocke/retourne des SECONDES. L'UI affiche en MINUTES. Les PATCH acceptent des MINUTES.

(() => {
  const $ = (id) => document.getElementById(id);
  let allSources = [];
  let schedulerInfo = {};
  let tierDefaults = [];

  const TIER_COLORS = { 1: '#ef4444', 2: '#f59e0b', 3: '#3b82f6', 4: '#8b5cf6' };

  /** Convert seconds from API to minutes for display. */
  function secToMin(s) { return s != null ? Math.round(s / 60) : null; }

  // ---------- Config ----------

  function initConfig() {
    const cfg = loadConfig();
    $('apiUrl').value = cfg.apiUrl || 'http://localhost:8000';
    $('adminToken').value = cfg.adminToken || '';
    $('saveConfig').addEventListener('click', () => {
      saveConfig({
        ...loadConfig(),
        apiUrl: $('apiUrl').value.trim(),
        adminToken: $('adminToken').value.trim(),
      });
      toast('Configuration sauvée', 'success');
      pingHealth();
      loadAll();
    });
  }

  async function pingHealth() {
    const dot = $('healthDot');
    dot.className = 'health-dot pending';
    try {
      const res = await fetch(getApiUrl() + '/health');
      dot.className = res.ok ? 'health-dot ok' : 'health-dot ko';
    } catch { dot.className = 'health-dot ko'; }
  }

  // ---------- Load ----------

  async function loadAll() {
    if (!getAdminToken()) {
      $('resultsContainer').innerHTML = '<div class="empty">Renseigne le <code>X-Admin-Token</code>.</div>';
      $('tierCards').innerHTML = '';
      return;
    }
    $('resultsContainer').innerHTML = '<div class="loading">Chargement…</div>';
    try {
      const [sourcesData, statusData, tierData] = await Promise.all([
        fetchAdmin('/scrapers/sources'),
        fetchAdmin('/scrapers/scheduler/status'),
        fetchAdmin('/scrapers/scheduler/tier-defaults'),
      ]);
      allSources = (sourcesData.sources || [])
        .filter(s => s.config_status === 'validated')
        .sort((a, b) => a.name.localeCompare(b.name));
      schedulerInfo = statusData;
      tierDefaults = tierData.tier_defaults || [];
      renderSchedulerStatus();
      renderGlobalInfo();
      renderTierDefaults();
      render();
    } catch (e) {
      $('resultsContainer').innerHTML = `<div class="error">Erreur : ${escapeHtml(e.message)}</div>`;
    }
  }

  // ---------- Scheduler status ----------

  function renderSchedulerStatus() {
    const running = schedulerInfo.running;
    $('schedulerStatus').innerHTML = running
      ? '<span class="tag tag-yes">Actif</span>'
      : '<span class="tag tag-no">Arrêté</span>';
    $('schedulerStartBtn').disabled = running;
    $('schedulerStopBtn').disabled = !running;
  }

  function renderGlobalInfo() {
    const globalSec = schedulerInfo.global_interval_seconds || schedulerInfo.global_interval_minutes * 60 || 600;
    const globalMin = secToMin(globalSec);
    const nextRun = schedulerInfo.jobs?.[0]?.next_run;
    let html = `<strong>Intervalle global du cycle :</strong> ${globalMin} min`;
    if (nextRun) html += ` — <strong>Prochain cycle :</strong> ${new Date(nextRun).toLocaleTimeString('fr-FR')}`;
    html += `<br><span class="text-muted">Le scheduler tourne toutes les ${globalMin} min. À chaque cycle, il ne scrape une source que si son intervalle effectif (custom > tier > global) est écoulé.</span>`;
    $('globalInfo').innerHTML = html;
  }

  // ---------- Tier defaults ----------

  function renderTierDefaults() {
    if (!tierDefaults.length) {
      $('tierCards').innerHTML = '<span class="text-muted">Aucun défaut tier configuré.</span>';
      return;
    }

    const cards = tierDefaults.map(t => {
      const color = TIER_COLORS[t.tier] || '#6b7280';
      const intervalSec = t.interval_seconds ?? t.interval_minutes * 60;
      const intervalMin = secToMin(intervalSec);
      return `
        <div class="tier-card" style="border-top: 3px solid ${color}">
          <div class="tier-card-header">
            <span class="tier-badge" style="background: ${color}">Tier ${t.tier}</span>
            <span class="tier-label">${escapeHtml(t.label || '')}</span>
          </div>
          <div class="tier-card-body">
            <div class="tier-current">${intervalMin} min</div>
            <div class="tier-edit">
              <input type="number" class="timer-input tier-input" data-tier="${t.tier}"
                value="${intervalMin}" min="1" max="1440" step="1">
              <span class="timer-unit">min</span>
              <button class="btn btn-sm btn-primary" data-action="save-tier" data-tier="${t.tier}">Appliquer</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    $('tierCards').innerHTML = cards;
  }

  // ---------- Render sources table ----------

  function render() {
    updateStats();
    if (!allSources.length) {
      $('resultsContainer').innerHTML = '<div class="empty">Aucune source validée. Valide des configs dans la page Validation Sources.</div>';
      return;
    }

    const effectiveIntervals = schedulerInfo.effective_intervals || {};
    const globalSec = schedulerInfo.global_interval_seconds || schedulerInfo.global_interval_minutes * 60 || 600;
    const globalMin = secToMin(globalSec);

    const rows = allSources.map(s => {
      const customSec = s.scraping_interval_seconds ?? (s.scraping_interval_minutes != null ? s.scraping_interval_minutes * 60 : null);
      const customMin = secToMin(customSec);
      const lastScraped = (schedulerInfo.last_scraped || {})[s.name];
      const lastScrapedLabel = lastScraped ? new Date(lastScraped).toLocaleString('fr-FR') : '—';
      const mode = s.scraping_mode || 'page';

      // Effective interval from API (seconds → minutes for display)
      const eff = effectiveIntervals[s.name] || {};
      const effectiveSec = eff.effective_seconds ?? eff.effective;
      const effectiveMin = secToMin(effectiveSec) || customMin || globalMin;
      const tier = eff.tier || 0;
      const tierDefaultSec = eff.tier_default_seconds ?? eff.tier_default;
      const tierDefaultMin = secToMin(tierDefaultSec);
      const tierColor = TIER_COLORS[tier] || '#6b7280';
      const customSecApi = eff.custom_seconds ?? eff.custom;

      // Determine cascade source label
      let cascadeLabel, cascadeClass;
      if (customSecApi != null) {
        cascadeLabel = 'custom';
        cascadeClass = 'timer-custom';
      } else if (tierDefaultSec != null) {
        cascadeLabel = 'tier';
        cascadeClass = 'timer-tier';
      } else {
        cascadeLabel = 'global';
        cascadeClass = 'timer-default';
      }

      const placeholderMin = tierDefaultMin || globalMin;

      return `
        <tr data-source="${escapeHtml(s.name)}">
          <td class="col-name"><strong>${escapeHtml(s.name)}</strong></td>
          <td>${tier ? `<span class="tier-badge-sm" style="background: ${tierColor}">T${tier}</span>` : '<span class="text-muted">—</span>'}</td>
          <td><span class="scraping-mode scraping-mode-${mode}"><span class="scraping-mode-label">${mode === 'bulk' ? 'Bulk' : 'Page'}</span><span class="scraping-mode-tooltip">${mode === 'bulk' ? 'Mode bulk : le scraper itère lui-même sur tous les codes postaux du département (API scrapers comme entreparticuliers, LBC).' : 'Mode page : le scheduler scrape page par page via build_url ou le pattern admin validé.'}</span></span></td>
          <td class="col-last-scraped"><span class="${lastScraped ? '' : 'text-muted'}">${lastScrapedLabel}</span></td>
          <td class="col-timer">
            <div class="timer-cell">
              <input type="number" class="timer-input" data-source="${escapeHtml(s.name)}"
                value="${customMin != null ? customMin : ''}"
                placeholder="${placeholderMin}"
                min="1" max="1440" step="1">
              <span class="timer-unit">min</span>
              ${customMin != null ? `<button class="btn btn-sm btn-ghost" data-action="reset-interval" data-source="${escapeHtml(s.name)}" title="Revenir au défaut tier/global">✕</button>` : ''}
            </div>
          </td>
          <td>
            <span class="timer-effective ${cascadeClass}">
              ${effectiveMin} min <span class="cascade-tag">${cascadeLabel}</span>
            </span>
          </td>
          <td class="col-props">${(s.property_types || []).join(', ') || '—'}</td>
          <td class="col-actions">
            <button class="btn btn-sm btn-primary" data-action="save" data-source="${escapeHtml(s.name)}">Appliquer</button>
            <button class="btn btn-sm btn-success" data-action="toggle-run" data-source="${escapeHtml(s.name)}" title="Lancer un scraping manuel">Run</button>
            <button class="btn btn-sm btn-ghost" data-action="reset" data-source="${escapeHtml(s.name)}" title="Reset : supprimer toutes les données de cette source" style="color:var(--danger,#ef4444)">Reset</button>
            <div class="run-form" data-run-form="${escapeHtml(s.name)}" hidden>
              <input type="text" class="run-input" data-run-dept="${escapeHtml(s.name)}" placeholder="Dept (ex: 37)" maxlength="3">
              <input type="number" class="run-input run-input-sm" data-run-pages="${escapeHtml(s.name)}" value="5" min="1" max="50" title="Max pages">
              <select class="run-input" data-run-tx="${escapeHtml(s.name)}">
                <option value="achat">Achat</option>
                <option value="location">Location</option>
              </select>
              <button class="btn btn-sm btn-success" data-action="exec-run" data-source="${escapeHtml(s.name)}">Lancer</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    $('resultsContainer').innerHTML = `
      <div class="table-wrap">
        <table class="sv-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Tier</th>
              <th>Mode</th>
              <th>Dernier scraping</th>
              <th>Timer personnalisé</th>
              <th>Effectif</th>
              <th>Property types</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function updateStats() {
    const customCount = allSources.filter(s => (s.scraping_interval_seconds ?? s.scraping_interval_minutes) != null).length;
    const effectiveIntervals = schedulerInfo.effective_intervals || {};
    const tierCount = allSources.filter(s => {
      const eff = effectiveIntervals[s.name];
      return eff && (eff.custom_seconds ?? eff.custom) == null && (eff.tier_default_seconds ?? eff.tier_default) != null;
    }).length;
    $('statsTotal').textContent = `Sources validées : ${allSources.length}`;
    $('statsCustom').textContent = `Custom : ${customCount}`;
    $('statsDefault').textContent = `Tier : ${tierCount} · Global : ${allSources.length - customCount - tierCount}`;
  }

  // ---------- Actions ----------
  // NOTE: PATCH endpoints accept MINUTES — no conversion needed on input.

  async function saveInterval(source) {
    const input = document.querySelector(`.timer-input[data-source="${source}"]`);
    const val = input.value.trim();
    const interval = val ? parseInt(val) : null;
    if (val && (isNaN(interval) || interval < 1 || interval > 1440)) {
      toast('Intervalle entre 1 et 1440 minutes', 'warn');
      return;
    }
    try {
      const qs = interval != null ? `?interval_minutes=${interval}` : '';
      await fetchAdmin(`/scrapers/scheduler/source-interval/${encodeURIComponent(source)}${qs}`, { method: 'PATCH' });
      const label = interval ? `${interval} min` : 'tier/global';
      toast(`Timer ${source} → ${label}`, 'success');
      loadAll();
    } catch (e) {
      toast(`Erreur : ${e.message}`, 'error');
    }
  }

  function toggleRunForm(source) {
    const form = document.querySelector(`[data-run-form="${source}"]`);
    if (!form) return;
    const isHidden = form.hidden;
    // Close all other open forms
    document.querySelectorAll('.run-form').forEach(f => { f.hidden = true; });
    form.hidden = !isHidden;
    if (!form.hidden) {
      const deptInput = form.querySelector(`[data-run-dept="${source}"]`);
      if (deptInput) deptInput.focus();
    }
  }

  async function execRun(source) {
    const dept = document.querySelector(`[data-run-dept="${source}"]`)?.value.trim() || '';
    const pages = document.querySelector(`[data-run-pages="${source}"]`)?.value || '5';
    const tx = document.querySelector(`[data-run-tx="${source}"]`)?.value || 'achat';
    const qs = new URLSearchParams({ max_pages: pages, transaction: tx });
    if (dept) qs.set('department', dept);
    try {
      await fetchAdmin(`/scrapers/ingest/${encodeURIComponent(source)}?${qs}`, { method: 'POST' });
      const label = dept ? `${source} (dept ${dept}, ${pages} pages, ${tx})` : `${source} (${pages} pages, ${tx})`;
      toast(`Scraping lancé : ${label}`, 'success');
      // Close form
      const form = document.querySelector(`[data-run-form="${source}"]`);
      if (form) form.hidden = true;
    } catch (e) {
      toast(`Erreur : ${e.message}`, 'error');
    }
  }

  async function resetInterval(source) {
    try {
      await fetchAdmin(`/scrapers/scheduler/source-interval/${encodeURIComponent(source)}`, { method: 'PATCH' });
      toast(`Timer ${source} → défaut tier/global`, 'success');
      loadAll();
    } catch (e) {
      toast(`Erreur : ${e.message}`, 'error');
    }
  }

  async function saveTierDefault(tier) {
    const input = document.querySelector(`.tier-input[data-tier="${tier}"]`);
    const val = input.value.trim();
    const interval = parseInt(val);
    if (!val || isNaN(interval) || interval < 1 || interval > 1440) {
      toast('Intervalle entre 1 et 1440 minutes', 'warn');
      return;
    }
    try {
      await fetchAdmin(`/scrapers/scheduler/tier-defaults/${tier}?interval_minutes=${interval}`, { method: 'PATCH' });
      toast(`Tier ${tier} → ${interval} min`, 'success');
      loadAll();
    } catch (e) {
      toast(`Erreur : ${e.message}`, 'error');
    }
  }

  // Wire actions via delegation (source table + tier cards)
  function wireActions() {
    $('resultsContainer').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const source = btn.dataset.source;
      if (btn.dataset.action === 'save') saveInterval(source);
      else if (btn.dataset.action === 'reset-interval') resetInterval(source);
      else if (btn.dataset.action === 'toggle-run') toggleRunForm(source);
      else if (btn.dataset.action === 'exec-run') execRun(source);
      else if (btn.dataset.action === 'reset') openResetModal(source);
    });

    $('tierCards').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="save-tier"]');
      if (!btn) return;
      saveTierDefault(parseInt(btn.dataset.tier));
    });
  }

  // ---------- Reset scraper ----------

  let resetTarget = null;

  function openResetModal(source) {
    resetTarget = source;
    $('resetSourceName').textContent = source;
    $('resetModal').hidden = false;
  }

  function closeResetModal() {
    $('resetModal').hidden = true;
    resetTarget = null;
  }

  async function doReset() {
    if (!resetTarget) return;
    $('resetConfirm').disabled = true;
    $('resetConfirm').textContent = 'Reset en cours…';
    try {
      const data = await fetchAdmin(`/scrapers/reset/${encodeURIComponent(resetTarget)}`, { method: 'POST' });
      toast(
        `${resetTarget} reset : ${data.deleted_ad_sources} ad_sources, ${data.deleted_canonical_ads} canonical_ads, ${data.deleted_init_segments} segments supprimés`,
        'success'
      );
      closeResetModal();
      loadAll();
    } catch (e) {
      toast(`Erreur reset : ${e.message}`, 'error');
    } finally {
      $('resetConfirm').disabled = false;
      $('resetConfirm').textContent = 'Confirmer le reset';
    }
  }

  $('resetCancel').addEventListener('click', closeResetModal);
  $('resetConfirm').addEventListener('click', doReset);
  $('resetModal').addEventListener('click', (e) => {
    if (e.target === $('resetModal')) closeResetModal();
  });

  // ---------- Scheduler controls ----------

  async function schedulerStart() {
    try {
      await fetchAdmin('/scrapers/scheduler/start?interval_minutes=10', { method: 'POST' });
      toast('Scheduler démarré', 'success');
      loadAll();
    } catch (e) { toast(`Erreur : ${e.message}`, 'error'); }
  }

  async function schedulerStop() {
    try {
      await fetchAdmin('/scrapers/scheduler/stop', { method: 'POST' });
      toast('Scheduler arrêté', 'success');
      loadAll();
    } catch (e) { toast(`Erreur : ${e.message}`, 'error'); }
  }

  async function schedulerRun() {
    try {
      await fetchAdmin('/scrapers/scheduler/run', { method: 'POST' });
      toast('Cycle lancé en arrière-plan', 'success');
    } catch (e) { toast(`Erreur : ${e.message}`, 'error'); }
  }

  $('schedulerStartBtn').addEventListener('click', schedulerStart);
  $('schedulerStopBtn').addEventListener('click', schedulerStop);
  $('schedulerRunBtn').addEventListener('click', schedulerRun);
  $('reloadBtn').addEventListener('click', loadAll);

  // ---------- Init ----------

  initConfig();
  wireActions();
  pingHealth();
  loadAll();
})();
