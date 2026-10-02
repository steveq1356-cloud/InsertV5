/* InsertPress Planner — the hole list: filter by size and status, sort,
 * multi-select (click, Ctrl/Cmd-click, Shift-click, checkboxes, Shift-drag in
 * the view), bulk press/skip/insert/sink, and drag to reorder.
 * app.js calls IP.ui.holes.init(ctx) and then ui.render() from refresh().
 */
(function () {
  'use strict';
  const IP = window.IP;
  IP.ui = IP.ui || {};
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const X_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg>';
  const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

  function init(ctx) {
    const $ = (id) => document.getElementById(id);
    const S = ctx.S;
    S.sel = new Set();
    S.list = { filter: 'all', sizes: [], sort: 'order', dir: 1 };
    let anchor = null, lastRows = [];

    $('hole-sort').innerHTML = IP.holeList.SORTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    $('bk-insert').innerHTML = '<option value="">Insert…</option>' + Object.entries(IP.INSERTS).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');

    const coords = (h) => IP.place.toWorld(ctx.insts()[0], h.x, h.y);
    const issueMap = () => {
      const m = new Map();
      for (const i of (S.result && S.result.issues) || []) {
        if (i.localId == null) continue;
        if (!m.has(i.localId)) m.set(i.localId, []);
        const t = i.text.replace(/^Hole \d+:?\s*/, '').replace(/^(is|measures|has|goes|would)/, 'This hole $1').replace(/^./, (c) => c.toUpperCase());
        if (!m.get(i.localId).some((x) => x.text === t)) m.get(i.localId).push({ text: t, level: i.level, kind: i.kind });
      }
      return m;
    };

    function render() {
      const issues = issueMap();
      const v = IP.holeList.view(S.holes, S.order, S.list, { coords, issues });
      lastRows = v.rows;
      for (const id of [...S.sel]) if (!ctx.byId(id)) S.sel.delete(id);

      // size chips act as filters
      const want = new Set(S.list.sizes);
      $('size-chips').innerHTML = v.sizes.map((g) => {
        const cls = [want.has(g.key) ? 'on' : '', g.inN === g.ids.length ? 'all' : g.inN ? 'some' : ''].join(' ');
        const name = g.key === 'hand' ? 'By hand' : '⌀' + g.key;
        return `<button class="chip ${cls}" data-chip="${g.key}" aria-pressed="${want.has(g.key)}" title="Show only ${name} holes (${g.inN} of ${g.ids.length} pressed)"><i class="dot"></i><b>${name}</b><span class="cnt">${g.ids.length}</span></button>`;
      }).join('');

      const c = v.counts;
      const seg = [['all', 'All', c.all], ['pressing', 'Pressing', c.pressing], ['skipped', 'Skipped', c.skipped], ['issues', 'Issues', c.issues]];
      $('hole-filter').innerHTML = seg.map(([k, l, n]) => `<button class="seg-btn${k === 'issues' && n ? ' warn' : ''}" data-filter="${k}" aria-checked="${S.list.filter === k}">${l}<span>${n}</span></button>`).join('');
      $('hole-sort').value = S.list.sort;
      $('hole-dir').hidden = S.list.sort === 'order';
      $('hole-dir').classList.toggle('desc', S.list.dir < 0);
      $('btn-use-sort').hidden = S.list.sort === 'order' || S.order.length < 2;

      // rows
      const n = S.order.length;
      const canDrag = S.list.sort === 'order';
      let divided = false;
      const html = [];
      for (const r of v.rows) {
        const h = r.h, used = r.idx >= 0, w = coords(h);
        if (canDrag && !used && !divided && n && S.list.filter === 'all') { html.push('<li class="divider" aria-hidden="true">Not pressed</li>'); divided = true; }
        const bad = r.issues.some((i) => i.level === 'error');
        const flags = r.issues.slice(0, 3).map((i) => `<div class="flag${i.level === 'error' ? ' err' : ''}">${esc(i.text)}</div>`).join('');
        const action = used
          ? `<button class="x-btn" data-remove="${h.id}" title="Take out of the press order" aria-label="Take hole ${r.idx + 1} out">${X_ICON}</button>`
          : h.source === 'manual' ? `<button class="x-btn" data-delete="${h.id}" title="Delete this hand-placed hole" aria-label="Delete hole">${X_ICON}</button>` : '<span></span>';
        html.push(`<li class="hole${used ? '' : ' skip'}${h.id === S.activeId ? ' active' : ''}${S.sel.has(h.id) ? ' sel' : ''}" data-id="${h.id}" draggable="${canDrag && used}">
          <label class="ck" title="Select"><input type="checkbox" data-sel="${h.id}"${S.sel.has(h.id) ? ' checked' : ''} aria-label="Select hole"><span></span></label>
          <span class="tag${bad ? ' bad' : ''}${used ? '' : ' add'}" ${used ? 'title="Drag to reorder"' : `data-add="${h.id}" title="Add to the press order"`}>${used ? r.idx + 1 : '+'}</span>
          <div class="xy"><i>X</i><span>${f2(w.x)}</span><i>Y</i><span>${f2(w.y)}</span></div>
          <div class="ins"><select data-insert="${h.id}" aria-label="Insert">${ctx.insertOptions(h.insert)}</select></div>
          ${action}
          <div class="meta">${ctx.holeMeta(h)}</div>
          ${h.id === S.activeId ? ctx.inspector(h) : ''}${flags}</li>`);
      }
      $('hole-list').innerHTML = html.join('');
      const shown = v.rows.length;
      $('list-head').hidden = !S.holes.length;
      $('shown-n').textContent = shown === S.holes.length ? `${shown} hole${shown === 1 ? '' : 's'}` : `${shown} of ${S.holes.length} shown`;
      const selShown = v.rows.filter((r) => S.sel.has(r.id)).length;
      $('sel-all').checked = shown > 0 && selShown === shown;
      $('sel-all').indeterminate = selShown > 0 && selShown < shown;
      $('btn-press-shown').disabled = !v.rows.some((r) => r.idx < 0);
      $('btn-skip-shown').disabled = !v.rows.some((r) => r.idx >= 0);

      // bulk bar
      const ns = S.sel.size;
      $('bulk').hidden = !ns;
      $('bulk-n').textContent = `${ns} selected`;
      $('bk-del').hidden = ![...S.sel].some((id) => { const h = ctx.byId(id); return h && h.source === 'manual'; });
      $('order-empty').hidden = S.order.length > 0 || !S.part;
      $('btn-optimize').disabled = S.order.length < 3;
    }

    /* ---------- selection ---------- */
    function select(id, mods) {
      if (mods.shift && anchor != null) {
        for (const x of IP.holeList.range(lastRows, anchor, id)) S.sel.add(x);
      } else if (mods.toggle) {
        if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
        anchor = id;
      } else {
        const only = S.sel.size === 1 && S.sel.has(id);
        S.sel = new Set(only && S.activeId === id ? [] : [id]);
        S.activeId = only && S.activeId === id ? null : id;
        anchor = id;
      }
      ctx.redraw();
    }
    function selectIds(ids, add) {
      if (!add) S.sel = new Set();
      for (const id of ids) S.sel.add(id);
      if (ids.length) anchor = ids[ids.length - 1];
      ctx.redraw();
    }
    function clearSel() { S.sel = new Set(); ctx.redraw(); }
    function selectShown() { selectIds(lastRows.map((r) => r.id), false); }

    /* ---------- events ---------- */
    $('size-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-chip]');
      if (!b) return;
      const k = b.dataset.chip;
      const s = new Set(S.list.sizes);
      if (s.has(k)) s.delete(k); else s.add(k);
      S.list.sizes = [...s];
      render();
    });
    $('hole-filter').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      S.list.filter = b.dataset.filter;
      render();
    });
    $('hole-sort').addEventListener('change', (e) => { S.list.sort = e.target.value; S.list.dir = 1; render(); });
    $('hole-dir').addEventListener('click', () => { S.list.dir = -S.list.dir; render(); });
    $('btn-use-sort').addEventListener('click', () => {
      ctx.remember();
      S.order = IP.holeList.orderBy(S.holes, S.order, S.list.sort, S.list.dir, { coords });
      S.list.sort = 'order';
      ctx.refresh();
      ctx.toast('Press order now follows that sort.');
    });
    $('sel-all').addEventListener('change', (e) => { if (e.target.checked) selectShown(); else clearSel(); });
    $('btn-press-shown').addEventListener('click', () => {
      ctx.remember();
      for (const r of lastRows) if (r.idx < 0) S.order.push(r.id);
      ctx.refresh();
    });
    $('btn-skip-shown').addEventListener('click', () => {
      ctx.remember();
      const out = new Set(lastRows.map((r) => r.id));
      S.order = S.order.filter((id) => !out.has(id));
      if (out.has(S.activeId)) S.activeId = null;
      ctx.refresh();
    });

    // bulk
    const selected = () => lastRows.map((r) => r.id).filter((id) => S.sel.has(id)).concat([...S.sel].filter((id) => !lastRows.some((r) => r.id === id)));
    $('bk-press').addEventListener('click', () => {
      ctx.remember();
      for (const id of selected()) if (!S.order.includes(id)) S.order.push(id);
      ctx.refresh();
    });
    $('bk-skip').addEventListener('click', () => {
      ctx.remember();
      S.order = S.order.filter((id) => !S.sel.has(id));
      ctx.refresh();
    });
    $('bk-insert').addEventListener('change', (e) => {
      const v = e.target.value;
      if (!v) return;
      ctx.remember();
      for (const id of S.sel) { const h = ctx.byId(id); if (h) h.insert = v; }
      e.target.value = '';
      ctx.refresh();
      ctx.toast(`${S.sel.size} hole${S.sel.size === 1 ? '' : 's'} set to ${IP.INSERTS[v].name}.`);
    });
    $('bk-sink').addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      ctx.remember();
      for (const id of S.sel) { const h = ctx.byId(id); if (h) h.sink = isFinite(v) ? v : null; }
      ctx.refresh();
      ctx.toast(isFinite(v) ? `Finish ${v} mm below the surface on ${S.sel.size} holes.` : 'Selected holes use the default finish depth again.');
    });
    $('bk-del').addEventListener('click', () => {
      ctx.remember();
      const del = new Set([...S.sel].filter((id) => { const h = ctx.byId(id); return h && h.source === 'manual'; }));
      S.holes = S.holes.filter((h) => !del.has(h.id));
      S.order = S.order.filter((id) => !del.has(id));
      for (const id of del) S.sel.delete(id);
      ctx.refresh();
    });
    $('bk-clear').addEventListener('click', clearSel);

    const list = $('hole-list');
    list.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) { ctx.toggleOrder(+rm.dataset.remove); return; }
      const del = e.target.closest('[data-delete]');
      if (del) { ctx.remember(); const id = +del.dataset.delete; S.holes = S.holes.filter((h) => h.id !== id); S.sel.delete(id); ctx.refresh(); return; }
      const add = e.target.closest('[data-add]');
      if (add) { ctx.toggleOrder(+add.dataset.add); return; }
      if (e.target.closest('select, input, label, .insp, .sink')) return;
      const li = e.target.closest('.hole');
      if (!li) return;
      select(+li.dataset.id, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey });
    });
    list.addEventListener('change', (e) => {
      const ck = e.target.closest('[data-sel]');
      if (ck) {
        const id = +ck.dataset.sel;
        if (ck.checked) S.sel.add(id); else S.sel.delete(id);
        anchor = id;
        ctx.redraw();
        return;
      }
      const sel = e.target.closest('[data-insert]');
      if (sel) {
        const id = +sel.dataset.insert;
        ctx.remember();
        const ids = S.sel.has(id) && S.sel.size > 1 ? [...S.sel] : [id];
        for (const x of ids) { const h = ctx.byId(x); if (h) h.insert = sel.value; }
        if (ids.length > 1) ctx.toast(`${ids.length} selected holes set to ${IP.INSERTS[sel.value].name}.`);
        ctx.refresh();
        return;
      }
      const sk = e.target.closest('[data-sink]');
      if (sk) { ctx.remember(); const v = parseFloat(sk.value); ctx.byId(+sk.dataset.sink).sink = isFinite(v) ? v : null; ctx.refresh(); }
    });
    list.addEventListener('mouseover', (e) => {
      const li = e.target.closest('.hole');
      const id = li ? +li.dataset.id : null;
      if (id !== S.hoverId) { S.hoverId = id; ctx.updateView(); }
    });
    list.addEventListener('mouseleave', () => { S.hoverId = null; ctx.updateView(); });

    // drag to reorder (press-order sort only)
    let dragId = null;
    list.addEventListener('dragstart', (e) => {
      const li = e.target.closest('.hole');
      if (!li || li.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
      dragId = +li.dataset.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragId));
    });
    list.addEventListener('dragover', (e) => {
      if (dragId == null) return;
      e.preventDefault();
      list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      const li = e.target.closest('.hole');
      if (!li || !S.order.includes(+li.dataset.id)) return;
      const r = li.getBoundingClientRect();
      li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const li = e.target.closest('.hole');
      if (dragId == null || !li) return;
      const target = +li.dataset.id;
      if (target !== dragId && S.order.includes(target)) {
        ctx.remember();
        const after = li.classList.contains('drop-after');
        S.order.splice(S.order.indexOf(dragId), 1);
        S.order.splice(S.order.indexOf(target) + (after ? 1 : 0), 0, dragId);
      }
      dragId = null;
      ctx.refresh();
    });
    list.addEventListener('dragend', () => {
      dragId = null;
      list.querySelectorAll('.dragging, .drop-before, .drop-after').forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after'));
    });

    return { render, select, selectIds, clearSel, selectShown, get rows() { return lastRows; } };
  }

  IP.ui.holes = { init };
})();
