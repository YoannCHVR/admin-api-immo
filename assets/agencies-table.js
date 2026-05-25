// Tableau agences par code postal

(() => {
  const STATUS_ORDER = ['pending', 'to_scrape', 'scraped', 'skip', 'closed'];
  const $ = (id) => document.getElementById(id);

  let allAgencies = [];
  let totalInDb = 0;
  let nafLoaded = false;  // le registre NAF n'est chargé qu'une fois

  // ---------- Config bar ----------

  function initConfigBar() {
    const cfg = loadConfig();
    $('apiUrl').value = cfg.apiUrl || 'http://localhost:8000';
    $('adminToken').value = cfg.adminToken || '';

    $('saveConfig').addEventListener('click', () => {
      saveConfig({
        apiUrl: $('apiUrl').value.trim(),
        adminToken: $('adminToken').value.trim(),
      });
      toast('Configuration sauvée', 'success');
      pingHealth();
      load();
    });
  }

  async function pingHealth() {
    const dot = $('healthDot');
    dot.className = 'health-dot pending';
    try {
      const res = await fetch(getApiUrl() + '/health');
      dot.className = res.ok ? 'health-dot ok' : 'health-dot ko';
    } catch {
      dot.className = 'health-dot ko';
    }
  }

  // ---------- Data load ----------

  async function load() {
    if (!getAdminToken()) {
      $('resultsContainer').innerHTML =
        '<div class="empty">Renseigne le <code>X-Admin-Token</code> en haut à droite, puis clique sur Sauver.</div>';
      resetStats();
      return;
    }
    $('resultsContainer').innerHTML = '<div class="loading">Chargement…</div>';
    try {
      await ensureNafCodes();
      // Build server-side filters for initial load
      const params = new URLSearchParams({ per_page: '50000', page: '1' });
      // Send status filter server-side if not all checked
      const checkedStatuses = [...document.querySelectorAll('#statusFilters input:checked')].map(i => i.value);
      const allStatuses = [...document.querySelectorAll('#statusFilters input')].map(i => i.value);
      if (checkedStatuses.length < allStatuses.length && checkedStatuses.length > 0) {
        params.set('status', checkedStatuses[0]); // API accepts single status
      }
      const deptVal = $('deptFilter').value;
      if (deptVal) params.set('dept', deptVal);
      const sourceVal = $('sourceFilter').value;
      if (sourceVal) params.set('source', sourceVal);
      const nafVal = $('nafFilter').value;
      if (nafVal) params.set('naf', nafVal);

      const data = await fetchAdmin(`/admin/agencies?${params}`);
      allAgencies = data.items || [];
      totalInDb = data.total || 0;
      populateFilterOptions();
      render();
    } catch (e) {
      $('resultsContainer').innerHTML = `<div class="error">Erreur de chargement : ${escapeHtml(e.message)}</div>`;
      toast(e.message, 'error');
    }
  }

  // Peuple le filtre NAF depuis le registre naf_filter (codes actifs + libellés).
  // Chargé une seule fois ; la liste ne dépend pas des agences affichées.
  async function ensureNafCodes() {
    if (nafLoaded) return;
    try {
      const codes = await fetchAdmin('/admin/agencies/naf-codes');
      const sel = $('nafFilter');
      const current = sel.value;
      sel.innerHTML = '<option value="">Tous</option>' +
        codes.map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.code)} — ${escapeHtml(c.label)}</option>`).join('');
      sel.value = current;
      nafLoaded = true;
    } catch (e) {
      // Non bloquant : on garde l'option "Tous" si le registre est indisponible.
      console.warn('NAF codes indisponibles :', e.message);
    }
  }

  function populateFilterOptions() {
    const depts = new Set();
    const sources = new Set();
    for (const a of allAgencies) {
      if (a.zipcode && a.zipcode.length >= 2) depts.add(a.zipcode.slice(0, 2));
      if (a.source) sources.add(a.source);
    }
    const deptSel = $('deptFilter');
    const currentDept = deptSel.value;
    deptSel.innerHTML = '<option value="">Tous</option>' +
      [...depts].sort().map(d => `<option value="${d}">${d}</option>`).join('');
    deptSel.value = currentDept;

    const srcSel = $('sourceFilter');
    const currentSrc = srcSel.value;
    srcSel.innerHTML = '<option value="">Toutes</option>' +
      [...sources].sort().map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    srcSel.value = currentSrc;
  }

  // ---------- Filters ----------

  function getFilters() {
    const statuses = [...document.querySelectorAll('#statusFilters input:checked')].map(i => i.value);
    return {
      statuses: new Set(statuses),
      dept: $('deptFilter').value,
      source: $('sourceFilter').value,
      naf: $('nafFilter').value,
      search: $('searchFilter').value.trim().toLowerCase(),
    };
  }

  function applyFilters(agencies, f) {
    return agencies.filter(a => {
      if (!f.statuses.has(a.status)) return false;
      if (f.dept && (!a.zipcode || !a.zipcode.startsWith(f.dept))) return false;
      if (f.source && a.source !== f.source) return false;
      if (f.naf && a.naf_code !== f.naf) return false;
      if (f.search) {
        const hay = [a.name || '', a.city || '', a.address || ''].join(' ').toLowerCase();
        if (!hay.includes(f.search)) return false;
      }
      return true;
    });
  }

  function groupByZip(agencies) {
    const groups = new Map();
    for (const a of agencies) {
      const key = a.zipcode || 'inconnu';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  // ---------- Render ----------

  function resetStats() {
    $('statsShown').textContent = 'Affichées : –';
    $('statsTotal').textContent = 'Total DB : –';
    $('statsCp').textContent = 'Codes postaux : –';
    $('statsNoGps').textContent = 'Sans GPS : –';
  }

  function render() {
    const filters = getFilters();
    const filtered = applyFilters(allAgencies, filters);
    const groups = groupByZip(filtered);

    const zipSet = new Set(filtered.map(a => a.zipcode).filter(Boolean));
    const noGps = filtered.filter(a => a.lat == null || a.lng == null).length;
    $('statsShown').textContent = `Affichées : ${filtered.length}`;
    $('statsTotal').textContent = `Total DB : ${totalInDb}`;
    $('statsCp').textContent = `Codes postaux : ${zipSet.size}`;
    $('statsNoGps').textContent = `Sans GPS : ${noGps}`;

    if (!filtered.length) {
      $('resultsContainer').innerHTML = '<div class="empty">Aucune agence ne correspond aux filtres.</div>';
      return;
    }

    const html = groups.map(([zip, items]) => {
      const city = items[0]?.city || '';
      const counts = Object.fromEntries(STATUS_ORDER.map(s => [s, 0]));
      for (const a of items) counts[a.status] = (counts[a.status] || 0) + 1;
      const badges = STATUS_ORDER
        .filter(s => counts[s] > 0)
        .map(s => `<span class="badge badge-${s}">${s} · ${counts[s]}</span>`)
        .join(' ');

      const rows = items.map(a => `
        <tr>
          <td class="col-name">${escapeHtml(a.name)}</td>
          <td>${escapeHtml(a.city)}</td>
          <td class="col-addr">${escapeHtml(a.address)}</td>
          <td><code>${escapeHtml(a.source)}</code></td>
          <td><span class="badge badge-${escapeHtml(a.status)}">${escapeHtml(a.status)}</span></td>
          <td>${a.phone ? `<a href="tel:${escapeHtml(a.phone)}">${escapeHtml(a.phone)}</a>` : '—'}</td>
          <td>${a.website ? `<a href="${escapeHtml(a.website)}" target="_blank" rel="noopener">lien</a>` : '—'}</td>
          <td><a href="${escapeHtml(getApiUrl())}/admin/agencies/${a.id}" target="_blank" rel="noopener">#${a.id}</a></td>
        </tr>
      `).join('');

      return `
        <details class="zip-group" open>
          <summary>
            <strong>CP ${escapeHtml(zip)}</strong>${city ? ` — ${escapeHtml(city)}` : ''}
            — ${items.length} agence${items.length > 1 ? 's' : ''}
            <span class="zip-badges">${badges}</span>
          </summary>
          <div class="table-wrap">
            <table class="agencies-table">
              <thead>
                <tr>
                  <th>Nom</th><th>Ville</th><th>Adresse</th><th>Source</th>
                  <th>Statut</th><th>Téléphone</th><th>Site</th><th>ID</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </details>
      `;
    }).join('');

    $('resultsContainer').innerHTML = html;
  }

  // ---------- Export CSV ----------

  function exportCsv() {
    const filters = getFilters();
    const filtered = applyFilters(allAgencies, filters);
    if (!filtered.length) {
      toast('Rien à exporter', 'warn');
      return;
    }
    const headers = ['id', 'name', 'address', 'city', 'zipcode', 'source', 'status', 'naf_code', 'phone', 'website', 'siret', 'lat', 'lng', 'discovered_at'];
    const esc = v => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [headers.join(',')];
    for (const a of filtered) {
      lines.push(headers.map(h => esc(a[h])).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `agences-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast(`${filtered.length} ligne(s) exportées`, 'success');
  }

  // ---------- Wire ----------

  function wireFilters() {
    const onClientFilter = () => render();
    const onServerFilter = () => load();  // Reload from API when major filters change
    document.querySelectorAll('#statusFilters input').forEach(i => i.addEventListener('change', onServerFilter));
    $('deptFilter').addEventListener('change', onServerFilter);
    $('sourceFilter').addEventListener('change', onServerFilter);
    $('nafFilter').addEventListener('change', onServerFilter);
    $('searchFilter').addEventListener('input', debounce(onClientFilter, 200));
    $('reloadBtn').addEventListener('click', load);
    $('resetBtn').addEventListener('click', () => {
      document.querySelectorAll('#statusFilters input').forEach(i => { i.checked = true; });
      $('deptFilter').value = '';
      $('sourceFilter').value = '';
      $('nafFilter').value = '';
      $('searchFilter').value = '';
      load();
    });
    $('exportBtn').addEventListener('click', exportCsv);
  }

  // ---------- Init ----------

  initConfigBar();
  wireFilters();
  pingHealth();
  load();
})();
