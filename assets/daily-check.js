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

  function fmtDateTime(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  // ── Vérifier une URL (lookup match exact, décision 100% backend) ──

  const SALE_STATUS = {
    available:        ['Disponible',     'sc-pill-ok'],
    under_offer:      ['Sous offre',     'sc-pill-warn'],
    under_compromise: ['Sous compromis', 'sc-pill-warn'],
    sold:             ['Vendu',          'sc-pill-err'],
  };

  async function runLookup() {
    const url = $('lookupInput').value.trim();
    if (!url) { $('lookupBtn').disabled = true; return; }

    // Garde token, cohérente avec la gestion d'auth du reste de la page
    if (!getAdminToken()) { renderLookupError('Non autorisé — token admin manquant/invalide', false); return; }

    const btn = $('lookupBtn');
    const origLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Vérification…';
    $('lookupResult').innerHTML = '<div class="sc-empty">Recherche…</div>';
    try {
      const data = await fetchAdmin(`/scrapers/daily-check/lookup?url=${encodeURIComponent(url)}`);
      $('lookupResult').innerHTML = data.found ? renderLookupFound(data) : renderLookupNotFound(data.url || url);
    } catch (e) {
      const m = e.message || '';
      if (m.startsWith('401') || m.startsWith('403') || /token admin manquant/i.test(m)) {
        renderLookupError('Non autorisé — token admin manquant/invalide', false);
      } else if (m.startsWith('422')) {
        renderLookupError('URL vide ou invalide', false);
      } else {
        renderLookupError('Erreur lors de la vérification. Réessaie.', true);
      }
    } finally {
      btn.textContent = origLabel;
      btn.disabled = !$('lookupInput').value.trim();
    }
  }

  function renderLookupFound(d) {
    const price = d.price != null ? `${Number(d.price).toLocaleString('fr-FR')} €` : '—';
    const surf = d.surface != null ? `${d.surface} m²` : null;
    const rooms = d.rooms != null ? `${d.rooms} pièce${d.rooms > 1 ? 's' : ''}` : null;
    const pt = d.property_type ? (PT_LABEL[d.property_type] || d.property_type) : null;
    const m2 = (d.price && d.surface) ? `${Math.round(d.price / d.surface).toLocaleString('fr-FR')} €/m²` : null;
    const meta = [pt, surf, rooms, m2].filter(Boolean).join(' · ');
    const loc = [d.city, d.zipcode].filter(Boolean).join(' ');
    const [ssLabel, ssClass] = SALE_STATUS[d.sale_status] || [d.sale_status || '—', 'sc-pill-none'];
    const thumb = d.image
      ? `<img class="dc-lookup-thumb" src="${escapeAttr(d.image)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'dc-lookup-thumb dc-ad-thumb-empty'}))">`
      : '<div class="dc-lookup-thumb dc-ad-thumb-empty"></div>';
    const fs = fmtDateTime(d.first_seen_at);
    const ls = fmtDateTime(d.last_seen_at);

    const others = (d.other_sources || []).length
      ? `<div class="dc-lookup-others">
           <div class="dc-lookup-others-title">Autres sources du même bien (${d.other_sources.length})</div>
           ${d.other_sources.map(s => `
             <a class="dc-lookup-other" href="${escapeAttr(s.url)}" target="_blank" rel="noopener">
               <span class="sc-pill dc-pill-source">${escapeHtml(s.source)}</span>
               <span class="dc-lookup-other-id">${escapeHtml(s.external_id || '')}</span>
               <span class="dc-ad-arrow">↗</span>
             </a>`).join('')}
         </div>`
      : '';

    return `
      <div class="dc-lookup-card dc-lookup-found">
        <div class="dc-lookup-card-head">
          <span class="dc-lookup-status dc-lookup-status-ok">Déjà scrapée</span>
          <span class="sc-pill dc-pill-source">${escapeHtml(d.source)}</span>
          <span class="sc-pill ${ssClass}">${escapeHtml(ssLabel)}</span>
        </div>
        <div class="dc-lookup-card-body">
          ${thumb}
          <div class="dc-lookup-info">
            <div class="dc-lookup-price">${price}</div>
            <div class="dc-lookup-title">${escapeHtml(d.title || '(sans titre)')}</div>
            ${meta ? `<div class="dc-lookup-metaline">${escapeHtml(meta)}</div>` : ''}
            ${loc ? `<div class="dc-lookup-loc">${escapeHtml(loc)}</div>` : ''}
            <dl class="dc-lookup-facts">
              ${fs ? `<div><dt>Première vue</dt><dd>${escapeHtml(fs)}</dd></div>` : ''}
              ${ls ? `<div><dt>Dernière vue</dt><dd>${escapeHtml(ls)}</dd></div>` : ''}
              ${d.external_id ? `<div><dt>ID externe</dt><dd>${escapeHtml(d.external_id)}</dd></div>` : ''}
            </dl>
            <a class="sc-btn sc-btn-sm sc-btn-ok dc-lookup-cta" href="${escapeAttr(d.url)}" target="_blank" rel="noopener">Voir l'annonce ↗</a>
          </div>
        </div>
        ${others}
      </div>`;
  }

  function renderLookupNotFound(url) {
    return `
      <div class="dc-lookup-card dc-lookup-notfound">
        <span class="dc-lookup-status dc-lookup-status-none">❌ Jamais scrapée</span>
        <div class="dc-lookup-tested">URL testée : <a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></div>
      </div>`;
  }

  function renderLookupError(msg, retry) {
    $('lookupResult').innerHTML = `
      <div class="dc-lookup-card dc-lookup-errstate">
        <span class="dc-lookup-status dc-lookup-status-err">⚠️ ${escapeHtml(msg)}</span>
        ${retry ? '<button class="sc-btn sc-btn-sm" id="lookupRetry" type="button">Réessayer</button>' : ''}
      </div>`;
    if (retry) { const b = $('lookupRetry'); if (b) b.addEventListener('click', runLookup); }
  }

  // ── Wiring ──

  $('refreshBtn').addEventListener('click', loadSummary);
  $('fSource').addEventListener('change', renderGrid);
  $('fDept').addEventListener('input', debounce(renderGrid, 200));
  $('hideEmpty').addEventListener('change', renderGrid);

  $('lookupBtn').addEventListener('click', runLookup);
  $('lookupInput').addEventListener('input', () => { $('lookupBtn').disabled = !$('lookupInput').value.trim(); });
  $('lookupInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('lookupBtn').disabled) { e.preventDefault(); runLookup(); }
  });

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
