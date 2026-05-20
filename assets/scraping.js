// Unified Scraping Management — scheduler, config, init, intervals

(() => {
  const $ = (id) => document.getElementById(id);
  let sources = [];
  let segments = [];
  let schedulerInfo = {};
  let tierDefaults = [];
  let pollTimer = null;

  const TIER_COLORS = { 1: 'var(--tier-1)', 2: 'var(--tier-2)', 3: 'var(--tier-3)', 4: 'var(--tier-4)' };
  const secToMin = (s) => s != null ? Math.round(s / 60) : null;

  // ── Config ──

  function initConfig() {
    const cfg = loadConfig();
    $('apiUrl').value = cfg.apiUrl || 'http://localhost:8000';
    $('adminToken').value = cfg.adminToken || '';
    $('saveConfig').addEventListener('click', () => {
      saveConfig({ ...loadConfig(), apiUrl: $('apiUrl').value.trim(), adminToken: $('adminToken').value.trim() });
      toast('Config sauvée', 'success');
      pingHealth();
      loadAll();
    });
  }

  async function pingHealth() {
    const dot = $('healthDot'), text = $('healthText');
    try {
      const t0 = performance.now();
      const res = await fetch(getApiUrl() + '/health');
      const ms = Math.round(performance.now() - t0);
      dot.className = res.ok ? 'sc-health-dot ok' : 'sc-health-dot ko';
      text.textContent = res.ok ? `${ms}ms` : 'Err';
    } catch { dot.className = 'sc-health-dot ko'; text.textContent = '—'; }
  }

  // ── Data loading ──

  async function loadAll() {
    if (!getAdminToken()) { $('gridContainer').innerHTML = '<div class="sc-empty">Configure le token admin.</div>'; return; }
    try {
      const [srcData, statusData, tierData, segData] = await Promise.all([
        fetchAdmin('/scrapers/sources'),
        fetchAdmin('/admin/scrapers/scheduler/status'),
        fetchAdmin('/admin/scrapers/scheduler/tier-defaults'),
        fetchAdmin('/admin/scrapers/init/status'),
      ]);
      sources = (srcData.sources || []).sort((a, b) => a.name.localeCompare(b.name));
      schedulerInfo = statusData;
      tierDefaults = tierData.tier_defaults || [];
      segments = segData.segments || [];
      renderScheduler();
      renderTierDefaults();
      populateFilters();
      renderGrid();
    } catch (e) {
      $('gridContainer').innerHTML = `<div class="sc-empty" style="color:var(--danger)">${escapeHtml(e.message)}</div>`;
    }
  }

  // ── Section 1 — Scheduler ──

  function renderScheduler() {
    const running = schedulerInfo.running;
    const jobs = schedulerInfo.jobs || [];
    $('schedBadge').className = `sc-sched-badge ${running ? 'sc-sched-on' : 'sc-sched-off'}`;
    $('schedBadge').textContent = running ? 'Running' : 'Stopped';
    $('schedMeta').textContent = running ? `${jobs.length} job${jobs.length !== 1 ? 's' : ''} actif${jobs.length !== 1 ? 's' : ''}` : '';
    $('schedStartBtn').disabled = running;
    $('schedStopBtn').disabled = !running;
  }

  async function schedAction(action) {
    const map = {
      start: ['/admin/scrapers/scheduler/start', 'POST', 'Scheduler démarré'],
      stop: ['/admin/scrapers/scheduler/stop', 'POST', 'Scheduler arrêté'],
      run: ['/admin/scrapers/scheduler/run', 'POST', 'Cycle lancé'],
    };
    const [path, method, msg] = map[action];
    try { await fetchAdmin(path, { method }); toast(msg, 'success'); loadAll(); }
    catch (e) { toast(e.message, 'error'); }
  }

  $('schedStartBtn').addEventListener('click', () => schedAction('start'));
  $('schedStopBtn').addEventListener('click', () => schedAction('stop'));
  $('schedRunBtn').addEventListener('click', () => schedAction('run'));
  $('schedRefreshBtn').addEventListener('click', loadAll);

  // ── Section 2 — Tier defaults ──

  function renderTierDefaults() {
    if (!tierDefaults.length) { $('tierCards').innerHTML = '<span style="color:var(--ink-4)">Aucun tier configuré</span>'; $('tierHint').textContent = ''; return; }
    $('tierHint').textContent = tierDefaults.map(t => `T${t.tier}: ${secToMin(t.interval_seconds)}min`).join(' · ');
    $('tierCards').innerHTML = tierDefaults.map(t => {
      const color = TIER_COLORS[t.tier] || 'var(--ink-4)';
      const min = secToMin(t.interval_seconds);
      return `
        <div class="sc-tier-card" style="border-left:3px solid ${color}">
          <span class="sc-tier-badge" style="background:${color}">T${t.tier}</span>
          <span class="sc-tier-label">${escapeHtml(t.label || '')}</span>
          <span class="sc-tier-val">${min} min</span>
          <input type="number" class="sc-tier-input" data-tier="${t.tier}" value="${min}" min="1" max="1440">
          <button class="sc-btn sc-btn-sm" data-action="save-tier" data-tier="${t.tier}">OK</button>
        </div>`;
    }).join('');
  }

  $('tierCards').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="save-tier"]');
    if (!btn) return;
    const tier = btn.dataset.tier;
    const val = document.querySelector(`.sc-tier-input[data-tier="${tier}"]`)?.value;
    if (!val) return;
    try {
      await fetchAdmin(`/admin/scrapers/scheduler/tier-defaults/${tier}?interval_minutes=${val}`, { method: 'PATCH' });
      toast(`Tier ${tier} → ${val} min`, 'success'); loadAll();
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── Section 3 — Grid ──

  function populateFilters() {
    const sel = $('fSource');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Source</option>' + sources.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
    sel.value = cur;
  }

  function getFilters() {
    return {
      source: $('fSource').value,
      tier: $('fTier').value,
      config: $('fConfig').value,
      dept: $('fDept').value.trim(),
    };
  }

  function buildRows() {
    const f = getFilters();
    const eff = schedulerInfo.effective_intervals || {};
    const segMap = {};
    for (const s of segments) {
      segMap[s.source] = segMap[s.source] || [];
      segMap[s.source].push(s);
    }

    let rows = [];
    for (const src of sources) {
      const tier = src.tier || 0;
      const configStatus = src.config_status || 'no_config';
      const srcSegs = segMap[src.name] || [];
      const effData = eff[src.name] || {};
      const effectiveSec = effData.effective_seconds ?? effData.effective;
      const effectiveMin = secToMin(effectiveSec);
      const customSec = src.scraping_interval_seconds;
      const customMin = secToMin(customSec);
      const lastScraped = (schedulerInfo.last_scraped || {})[src.name];
      const adsTotal = src.ads_in_db || 0;

      // Cascade label
      let cascade = 'global';
      if (effData.custom_seconds ?? effData.custom) cascade = 'custom';
      else if (effData.tier_default_seconds ?? effData.tier_default) cascade = 'tier';

      // If source has segments, show one row per dept; otherwise one row for the source
      if (srcSegs.length > 0) {
        for (const seg of srcSegs) {
          rows.push({ src, tier, configStatus, seg, effectiveMin, cascade, customMin, lastScraped, adsTotal });
        }
      } else {
        rows.push({ src, tier, configStatus, seg: null, effectiveMin, cascade, customMin, lastScraped, adsTotal });
      }
    }

    // Apply filters
    if (f.source) rows = rows.filter(r => r.src.name === f.source);
    if (f.tier) rows = rows.filter(r => String(r.tier) === f.tier);
    if (f.config) rows = rows.filter(r => r.configStatus === f.config);
    if (f.dept) rows = rows.filter(r => r.seg?.department === f.dept);

    return rows;
  }

  function renderGrid() {
    const rows = buildRows();
    if (!rows.length) { $('gridContainer').innerHTML = '<div class="sc-empty">Aucune source ne correspond aux filtres.</div>'; return; }

    const html = rows.map(r => {
      const s = r.src;
      const name = s.name;
      const tierColor = TIER_COLORS[r.tier] || 'var(--ink-4)';
      const dept = r.seg?.department || '—';
      const segStatus = r.seg?.status || '—';
      const adsFound = r.seg?.ads_found ?? '—';
      const lastRun = r.seg?.last_run ? relTime(r.seg.last_run) : (r.lastScraped ? relTime(r.lastScraped) : '—');
      const interval = r.effectiveMin ? `${r.effectiveMin}m` : '—';

      // Config badge
      let configBadge;
      if (r.configStatus === 'validated') configBadge = '<span class="sc-pill sc-pill-ok">validated</span>';
      else if (r.configStatus === 'pending_review') configBadge = '<span class="sc-pill sc-pill-warn">pending</span>';
      else if (r.configStatus === 'rejected') configBadge = '<span class="sc-pill sc-pill-err">rejected</span>';
      else configBadge = '<span class="sc-pill sc-pill-none">no config</span>';

      // Init badge
      let initBadge;
      if (segStatus === 'done') initBadge = '<span class="sc-pill sc-pill-ok">done</span>';
      else if (segStatus === 'in_progress') initBadge = '<span class="sc-pill sc-pill-progress">in progress</span>';
      else if (segStatus === 'pending') initBadge = '<span class="sc-pill sc-pill-warn">pending</span>';
      else if (segStatus === 'failed') initBadge = '<span class="sc-pill sc-pill-err">failed</span>';
      else initBadge = '<span class="sc-pill sc-pill-none">—</span>';

      // Cascade tag
      const cascadeTag = `<span class="sc-cascade sc-cascade-${r.cascade}">${interval} <small>${r.cascade}</small></span>`;

      // Actions — contextual
      let actions = '';
      // Config actions
      if (r.configStatus === 'no_config') {
        actions += `<button class="sc-btn sc-btn-sm" data-action="auto-gen" data-source="${escapeHtml(name)}" title="Auto-generate config">Gen</button>`;
      }
      if (r.configStatus === 'pending_review') {
        actions += `<button class="sc-btn sc-btn-sm sc-btn-ok" data-action="validate" data-source="${escapeHtml(name)}" title="Validate">✓</button>`;
        actions += `<button class="sc-btn sc-btn-sm sc-btn-danger" data-action="reject" data-source="${escapeHtml(name)}" title="Reject">✗</button>`;
      }
      // Edit config (always if has config)
      if (r.configStatus !== 'no_config') {
        actions += `<button class="sc-btn sc-btn-sm" data-action="edit-config" data-source="${escapeHtml(name)}" title="Edit URL pattern">✎</button>`;
      }
      // Bootstrap (validated, no segment for this dept)
      if (r.configStatus === 'validated' && !r.seg) {
        actions += `<button class="sc-btn sc-btn-sm sc-btn-ok" data-action="bootstrap" data-source="${escapeHtml(name)}" title="Bootstrap department">Boot</button>`;
      }
      // Run now (segment done)
      if (r.seg?.status === 'done') {
        actions += `<button class="sc-btn sc-btn-sm sc-btn-ok" data-action="run-now" data-source="${escapeHtml(name)}" title="Run now">▶</button>`;
      }
      // Edit interval (validated)
      if (r.configStatus === 'validated') {
        actions += `<button class="sc-btn sc-btn-sm" data-action="edit-interval" data-source="${escapeHtml(name)}" title="Edit interval">⏱</button>`;
      }
      // Reset (always)
      actions += `<button class="sc-btn sc-btn-sm sc-btn-ghost" data-action="reset" data-source="${escapeHtml(name)}" title="Reset scraper">↺</button>`;

      return `
        <div class="sc-grid-row">
          <span class="sc-grid-name">${escapeHtml(name)}</span>
          <span>${r.tier ? `<span class="sc-tier-tag" style="background:${tierColor}">T${r.tier}</span>` : '—'}</span>
          <span>${configBadge}</span>
          <span>${initBadge} <span class="sc-grid-dept">${escapeHtml(dept)}</span></span>
          <span>${cascadeTag}</span>
          <span class="sc-grid-time">${lastRun}</span>
          <span class="sc-grid-ads">${adsFound}<span class="sc-grid-ads-total" title="Total cumulé pour ${escapeHtml(name)}"> / ${r.adsTotal}</span></span>
          <span class="sc-grid-actions">${actions}</span>
        </div>`;
    }).join('');

    $('gridContainer').innerHTML = `
      <div class="sc-grid-header">
        <span>Source</span><span>Tier</span><span>Config</span><span>Init</span><span>Interval</span><span>Last run</span><span>Ads</span><span>Actions</span>
      </div>
      ${html}`;
  }

  function relTime(iso) {
    if (!iso) return '—';
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return 'now';
    if (d < 3600) return `${Math.floor(d / 60)}min`;
    if (d < 86400) return `${Math.floor(d / 3600)}h`;
    return `${Math.floor(d / 86400)}j`;
  }

  // Filter wiring
  ['fSource', 'fTier', 'fConfig'].forEach(id => $(id).addEventListener('change', renderGrid));
  $('fDept').addEventListener('input', debounce(renderGrid, 200));

  // ── Actions (delegation) ──

  $('gridContainer').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const source = btn.dataset.source;

    if (action === 'validate') doValidate(source);
    else if (action === 'reject') openRejectModal(source);
    else if (action === 'auto-gen') doAutoGen();
    else if (action === 'edit-config') openConfigModal(source);
    else if (action === 'bootstrap') openBootstrapModal(source);
    else if (action === 'run-now') doRunNow(source);
    else if (action === 'edit-interval') openIntervalModal(source);
    else if (action === 'reset') openResetModal(source);
  });

  // ── Action handlers ──

  async function doValidate(source) {
    try { await fetchAdmin(`/scrapers/config/${encodeURIComponent(source)}/validate`, { method: 'PATCH' }); toast(`${source} validé`, 'success'); loadAll(); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function doAutoGen() {
    try { const d = await fetchAdmin('/scrapers/config/auto-generate', { method: 'POST' }); toast(`Généré: ${d.generated || 0}, existant: ${d.already_exists || 0}`, 'success'); loadAll(); }
    catch (e) { toast(e.message, 'error'); }
  }

  $('autoGenBtn').addEventListener('click', doAutoGen);

  async function doRunNow(source) {
    try { await fetchAdmin(`/admin/scrapers/scheduler/source/${encodeURIComponent(source)}/run`, { method: 'POST' }); toast(`${source} — run déclenché`, 'success'); }
    catch (e) { toast(e.message, 'error'); }
  }

  // ── Bootstrap modal ──
  let bootstrapTarget = null;
  function openBootstrapModal(source) { bootstrapTarget = source; $('bootstrapSource').textContent = source; $('bootstrapDept').value = $('fDept').value || ''; $('bootstrapModal').hidden = false; }
  $('bootstrapCancel').addEventListener('click', () => { $('bootstrapModal').hidden = true; });
  $('bootstrapModal').addEventListener('click', (e) => { if (e.target === $('bootstrapModal')) $('bootstrapModal').hidden = true; });
  $('bootstrapConfirm').addEventListener('click', async () => {
    const dept = $('bootstrapDept').value.trim();
    if (!dept) { toast('Département requis', 'warn'); return; }
    const pt = $('bootstrapPt').value;
    try {
      await fetchAdmin(`/admin/scrapers/init?department=${dept}&sources=${encodeURIComponent(bootstrapTarget)}&property_types=${pt}`, { method: 'POST' });
      toast(`SCRAP INIT ${bootstrapTarget} / dept ${dept} lancé`, 'success');
      $('bootstrapModal').hidden = true;
      $('fDept').value = dept;
      startPolling();
      loadAll();
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── Interval modal ──
  let intervalTarget = null;
  function openIntervalModal(source) {
    intervalTarget = source;
    $('intervalSource').textContent = source;
    const src = sources.find(s => s.name === source);
    const curMin = secToMin(src?.scraping_interval_seconds);
    $('intervalInput').value = curMin ?? '';
    $('intervalModal').hidden = false;
  }
  $('intervalCancel').addEventListener('click', () => { $('intervalModal').hidden = true; });
  $('intervalModal').addEventListener('click', (e) => { if (e.target === $('intervalModal')) $('intervalModal').hidden = true; });
  $('intervalSave').addEventListener('click', async () => {
    const val = $('intervalInput').value.trim();
    const qs = val ? `?interval_minutes=${val}` : '';
    try {
      await fetchAdmin(`/admin/scrapers/scheduler/source-interval/${encodeURIComponent(intervalTarget)}${qs}`, { method: 'PATCH' });
      toast(`${intervalTarget} → ${val ? val + ' min' : 'défaut tier'}`, 'success');
      $('intervalModal').hidden = true; loadAll();
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── Config modal ──
  let configTarget = null;
  function openConfigModal(source) {
    configTarget = source;
    $('configSource').textContent = source;
    const src = sources.find(s => s.name === source);
    $('configPattern').value = src?.url_pattern || '';
    $('configAdminUrl').value = src?.admin_url || '';
    $('configNotes').value = src?.notes || '';
    $('configModal').hidden = false;
  }
  $('configCancel').addEventListener('click', () => { $('configModal').hidden = true; });
  $('configModal').addEventListener('click', (e) => { if (e.target === $('configModal')) $('configModal').hidden = true; });
  $('configSave').addEventListener('click', async () => {
    const pattern = $('configPattern').value.trim();
    if (!pattern) { toast('URL pattern requis', 'warn'); return; }
    const qs = new URLSearchParams({ url_pattern: pattern });
    const notes = $('configNotes').value.trim();
    if (notes) qs.set('notes', notes);
    try {
      await fetchAdmin(`/scrapers/config/${encodeURIComponent(configTarget)}?${qs}`, { method: 'PUT' });
      // Also submit admin_url if provided
      const adminUrl = $('configAdminUrl').value.trim();
      if (adminUrl) {
        await fetchAdmin(`/scrapers/config/${encodeURIComponent(configTarget)}/admin-url?url=${encodeURIComponent(adminUrl)}`, { method: 'PATCH' });
      }
      toast(`Config ${configTarget} mise à jour`, 'success');
      $('configModal').hidden = true; loadAll();
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── Reject modal ──
  let rejectTarget = null;
  function openRejectModal(source) { rejectTarget = source; $('rejectSource').textContent = source; $('rejectReason').value = ''; $('rejectModal').hidden = false; }
  $('rejectCancel').addEventListener('click', () => { $('rejectModal').hidden = true; });
  $('rejectModal').addEventListener('click', (e) => { if (e.target === $('rejectModal')) $('rejectModal').hidden = true; });
  $('rejectConfirm').addEventListener('click', async () => {
    const reason = $('rejectReason').value.trim();
    const qs = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    try {
      await fetchAdmin(`/scrapers/config/${encodeURIComponent(rejectTarget)}/reject${qs}`, { method: 'PATCH' });
      toast(`${rejectTarget} rejeté`, 'success'); $('rejectModal').hidden = true; loadAll();
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── Reset modal ──
  let resetTarget = null;
  function openResetModal(source) { resetTarget = source; $('resetSource').textContent = source; $('resetModal').hidden = false; }
  $('resetCancel').addEventListener('click', () => { $('resetModal').hidden = true; });
  $('resetModal').addEventListener('click', (e) => { if (e.target === $('resetModal')) $('resetModal').hidden = true; });
  $('resetConfirm').addEventListener('click', async () => {
    try {
      const d = await fetchAdmin(`/scrapers/reset/${encodeURIComponent(resetTarget)}`, { method: 'POST' });
      toast(`${resetTarget} reset: ${d.deleted_ad_sources} sources, ${d.deleted_canonical_ads} ads, ${d.deleted_init_segments} segments`, 'success');
      $('resetModal').hidden = true; loadAll();
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── Polling ──

  function startPolling() {
    stopPolling();
    if ($('autoPoll').checked) {
      pollTimer = setInterval(() => { if (!document.hidden) loadAll(); }, 5000);
    }
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  $('autoPoll').addEventListener('change', () => { if ($('autoPoll').checked) startPolling(); else stopPolling(); });

  // ── Init ──

  initConfig();
  pingHealth();
  loadAll();
  startPolling();
})();
