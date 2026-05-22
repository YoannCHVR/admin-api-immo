// Vérifs quotidiennes — fraîcheur du scraping par source × département
// Résumé 3h/24h/48h (nouvelles vs vues) + drill-down annonces cliquables.

(() => {
  const $ = (id) => document.getElementById(id);

  let rows = [];          // résumé brut depuis /scrapers/daily-check
  let kind = 'new';       // 'new' (first_seen) | 'seen' (last_seen)
  let win = '24';         // '3' | '24' | '48'

  const PT_LABEL = { appartement: 'Appart.', maison: 'Maison', terrain: 'Terrain', immeuble: 'Immeuble', local: 'Local', parking: 'Parking' };

  // ── Config / health ──

  function initConfig() {
    const cfg = loadConfig();
    $('apiUrl').value = cfg.apiUrl || 'http://localhost:8000';
    $('adminToken').value = cfg.adminToken || '';
    $('saveConfig').addEventListener('click', () => {
      saveConfig({ ...loadConfig(), apiUrl: $('apiUrl').value.trim(), adminToken: $('adminToken').value.trim() });
      toast('Config sauvée', 'success');
      pingHealth();
      loadSummary();
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

  // ── Data ──

  async function loadSummary() {
    if (!getAdminToken()) { $('gridContainer').innerHTML = '<div class="sc-empty">Configure le token admin.</div>'; return; }
    $('gridContainer').innerHTML = '<div class="sc-empty">Chargement…</div>';
    try {
      const data = await fetchAdmin('/scrapers/daily-check');
      rows = data.rows || [];
      populateSourceFilter();
      if (data.generated_at) {
        $('genMeta').textContent = `Généré ${relTime(data.generated_at)} · ${rows.length} couples source × dépt`;
      }
      renderGrid();
    } catch (e) {
      $('gridContainer').innerHTML = `<div class="sc-empty" style="color:var(--danger)">${escapeHtml(e.message)}</div>`;
    }
  }

  function populateSourceFilter() {
    const sel = $('fSource');
    const current = sel.value;
    const names = [...new Set(rows.map(r => r.source))].sort();
    sel.innerHTML = '<option value="">Toutes sources</option>' + names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    if (names.includes(current)) sel.value = current;
  }

  // ── Filtering ──

  function visibleRows() {
    const fSource = $('fSource').value;
    const fDept = $('fDept').value.trim();
    const hideEmpty = $('hideEmpty').checked;
    return rows.filter(r => {
      if (fSource && r.source !== fSource) return false;
      if (fDept && r.department !== fDept) return false;
      if (hideEmpty && (r[kind]?.[`${win}h`] || 0) === 0) return false;
      return true;
    });
  }

  // ── Render summary grid ──

  function renderGrid() {
    const data = visibleRows();
    $('rowCount').textContent = `${data.length} ligne${data.length !== 1 ? 's' : ''}`;
    if (!data.length) { $('gridContainer').innerHTML = '<div class="sc-empty">Aucune donnée pour ces filtres.</div>'; return; }

    // Sort: most recent activity in the active window first, then total
    const wk = `${win}h`;
    data.sort((a, b) => (b[kind]?.[wk] || 0) - (a[kind]?.[wk] || 0) || (b.total || 0) - (a.total || 0));

    $('gridContainer').innerHTML = data.map(r => {
      const nw = r.new || {}, sw = r.seen || {};
      const activeVal = (kind === 'new' ? nw : sw)[wk] || 0;
      const hot = activeVal > 0 ? ' dc-hot' : '';
      return `
        <div class="dc-grid-row${hot}" data-source="${escapeHtml(r.source)}" data-dept="${escapeHtml(r.department)}" role="button" tabindex="0">
          <span class="dc-cell-source">${escapeHtml(r.source)}</span>
          <span class="dc-cell-dept">${escapeHtml(r.department)}</span>
          <span class="dc-counts ${kind === 'new' ? 'dc-counts-active' : ''}">${triplet(nw)}</span>
          <span class="dc-counts ${kind === 'seen' ? 'dc-counts-active' : ''}">${triplet(sw)}</span>
          <span class="dc-cell-total">${r.total ?? 0}</span>
          <span class="dc-cell-time">${r.last_seen_at ? relTime(r.last_seen_at) : '—'}</span>
          <span class="dc-cell-actions">
            ${r.admin_url ? `<a class="sc-btn sc-btn-sm" href="${escapeAttr(r.admin_url)}" target="_blank" rel="noopener" title="Ouvrir le site source (page admin de référence)" data-stop>Site ↗</a>` : ''}
            <button class="sc-btn sc-btn-sm sc-btn-ok" data-open title="Voir les annonces">Annonces</button>
          </span>
        </div>`;
    }).join('');
  }

  function triplet(w) {
    const v = (h) => {
      const n = w?.[`${h}h`] || 0;
      const cls = h === Number(win) ? 'dc-num dc-num-active' : 'dc-num';
      return `<span class="${cls}">${n}</span>`;
    };
    return `${v(3)}<span class="dc-sep">/</span>${v(24)}<span class="dc-sep">/</span>${v(48)}`;
  }

  // ── Drawer: ad detail list ──

  let drawerState = { source: null, dept: null, page: 1, total: 0 };

  async function openDrawer(source, dept) {
    drawerState = { source, dept, page: 1, total: 0 };
    $('drawer').hidden = false;
    $('drawer').setAttribute('aria-hidden', 'false');
    $('drawerOverlay').hidden = false;
    $('drawerTitle').textContent = `${source} · dépt ${dept}`;
    $('drawerActions').innerHTML = '';
    await loadDrawerAds();
  }

  function closeDrawer() {
    $('drawer').hidden = true;
    $('drawer').setAttribute('aria-hidden', 'true');
    $('drawerOverlay').hidden = true;
  }

  async function loadDrawerAds() {
    const { source, dept, page } = drawerState;
    const kindLabel = kind === 'new' ? 'nouvelles' : 'vues';
    $('drawerSub').textContent = `${kindLabel} · fenêtre ${win}h`;
    $('drawerBody').innerHTML = '<div class="sc-empty">Chargement…</div>';
    $('drawerFoot').innerHTML = '';
    const qs = new URLSearchParams({
      source, department: dept, window_hours: win, kind, page: String(page), per_page: '60',
    });
    try {
      const data = await fetchAdmin(`/scrapers/daily-check/ads?${qs}`);
      drawerState.total = data.total || 0;
      renderDrawer(data);
    } catch (e) {
      $('drawerBody').innerHTML = `<div class="sc-empty" style="color:var(--danger)">${escapeHtml(e.message)}</div>`;
    }
  }

  function renderDrawer(data) {
    const items = data.items || [];
    $('drawerSub').textContent = `${kind === 'new' ? 'nouvelles' : 'vues'} · fenêtre ${win}h · ${data.total} annonce${data.total !== 1 ? 's' : ''}`;

    if (!items.length) {
      $('drawerBody').innerHTML = '<div class="sc-empty">Aucune annonce sur cette fenêtre. Possible delta : le scraper n\'a rien remonté ici.</div>';
      $('drawerFoot').innerHTML = '';
      return;
    }

    $('drawerBody').innerHTML = items.map(it => {
      const price = it.price != null ? `${Number(it.price).toLocaleString('fr-FR')} €` : '— €';
      const surf = it.surface != null ? `${it.surface} m²` : '';
      const rooms = it.rooms != null ? `${it.rooms} p.` : '';
      const m2 = (it.price && it.surface) ? `${Math.round(it.price / it.surface).toLocaleString('fr-FR')} €/m²` : '';
      const pt = PT_LABEL[it.property_type] || it.property_type || '';
      const meta = [pt, surf, rooms, m2].filter(Boolean).join(' · ');
      const loc = [it.city, it.zipcode].filter(Boolean).join(' ');
      const thumb = it.image
        ? `<img class="dc-ad-thumb" src="${escapeAttr(it.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : '<div class="dc-ad-thumb dc-ad-thumb-empty"></div>';
      return `
        <a class="dc-ad" href="${escapeAttr(it.url)}" target="_blank" rel="noopener">
          ${thumb}
          <div class="dc-ad-body">
            <div class="dc-ad-top">
              <span class="dc-ad-price">${price}</span>
              ${it.is_new ? '<span class="dc-ad-new">NEW</span>' : ''}
            </div>
            <div class="dc-ad-title">${escapeHtml(it.title || '(sans titre)')}</div>
            <div class="dc-ad-meta">${escapeHtml(meta)}</div>
            <div class="dc-ad-foot">
              <span class="dc-ad-loc">${escapeHtml(loc || '—')}</span>
              <span class="dc-ad-seen">vu ${relTime(it.last_seen_at)}</span>
            </div>
          </div>
          <span class="dc-ad-arrow">↗</span>
        </a>`;
    }).join('');

    // Pagination
    const perPage = data.per_page || 60;
    const pages = Math.max(1, Math.ceil((data.total || 0) / perPage));
    if (pages > 1) {
      $('drawerFoot').innerHTML = `
        <button class="sc-btn sc-btn-sm" id="pgPrev" ${data.page <= 1 ? 'disabled' : ''}>← Préc.</button>
        <span class="dc-pg">${data.page} / ${pages}</span>
        <button class="sc-btn sc-btn-sm" id="pgNext" ${data.page >= pages ? 'disabled' : ''}>Suiv. →</button>`;
      const prev = $('pgPrev'), next = $('pgNext');
      if (prev) prev.addEventListener('click', () => { drawerState.page--; loadDrawerAds(); });
      if (next) next.addEventListener('click', () => { drawerState.page++; loadDrawerAds(); });
    } else {
      $('drawerFoot').innerHTML = '';
    }
  }

  // ── Time helper ──

  function relTime(iso) {
    if (!iso) return '—';
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 0) return 'à l\'instant';
    if (d < 60) return 'à l\'instant';
    if (d < 3600) return `il y a ${Math.floor(d / 60)}min`;
    if (d < 86400) return `il y a ${Math.floor(d / 3600)}h`;
    return `il y a ${Math.floor(d / 86400)}j`;
  }

  function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }

  // ── Wiring ──

  $('refreshBtn').addEventListener('click', loadSummary);
  $('fSource').addEventListener('change', renderGrid);
  $('fDept').addEventListener('input', debounce(renderGrid, 200));
  $('hideEmpty').addEventListener('change', renderGrid);

  $('kindSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.dc-seg-btn'); if (!btn) return;
    kind = btn.dataset.kind;
    $('kindSeg').querySelectorAll('.dc-seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderGrid();
    if (!$('drawer').hidden) loadDrawerAds();
  });

  $('winSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.dc-seg-btn'); if (!btn) return;
    win = btn.dataset.win;
    $('winSeg').querySelectorAll('.dc-seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderGrid();
    if (!$('drawer').hidden) { drawerState.page = 1; loadDrawerAds(); }
  });

  $('gridContainer').addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return; // let "Site ↗" link work
    const row = e.target.closest('.dc-grid-row'); if (!row) return;
    openDrawer(row.dataset.source, row.dataset.dept);
  });
  $('gridContainer').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.dc-grid-row'); if (!row) return;
    e.preventDefault();
    openDrawer(row.dataset.source, row.dataset.dept);
  });

  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerOverlay').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('drawer').hidden) closeDrawer(); });

  // ── Boot ──
  initConfig();
  pingHealth();
  loadSummary();
})();
