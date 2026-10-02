/* InsertPress Planner — app wiring (v4). Hole list: ui-holes.js. Machine panel: ui-machine.js. */
(function () {
  'use strict';
  const IP = window.IP;
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const fmt = IP.gcode.fmt;
  const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const X_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg>';

  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }
  function fmtLong(s) {
    s = Math.round(s);
    const m = Math.floor(s / 60), sec = s % 60;
    return m ? `${m} min ${sec} s` : `${sec} s`;
  }

  /* ---------- settings schema ---------- */
  const SCHEMA = [
    { group: 'Job', items: [
      { key: 'mode', label: 'Motion', type: 'select', options: [['xy', 'Move X and Y'], ['manual', 'Z only']],
        help: 'Z only is for the press head before the gantry exists. The job pauses at each hole so you slide the part under the tip.' },
      { key: 'loadMode', label: 'Load inserts', type: 'select', options: [['each', 'Before each hole'], ['start', 'All at the start']] },
      { key: 'overloadStop', label: 'Stop if the float sensor trips', type: 'bool',
        help: 'Presses with G38.3, so the plunge halts if the float sensor on the probe pin trips (crooked insert, missing hole).' },
      { key: 'defaultInsert', label: 'Insert for hand-placed holes', type: 'insert' },
    ] },
    { group: 'Material', items: [
      { key: 'material', label: 'Plastic', type: 'material',
        help: 'Picking a plastic fills in a starting tip temperature, press speed, and hold time. Tune them on a test print.' },
      { key: 'tipTemp', label: 'Iron temperature', unit: '°C', step: 5 },
    ] },
    { group: 'Press', items: [
      { key: 'sink', label: 'Finish below the surface', unit: 'mm', step: 0.05 },
      { key: 'approachGap', label: 'Slow down above the insert', unit: 'mm', step: 0.5 },
      { key: 'pressFeed', label: 'Press speed', unit: 'mm/min', step: 5 },
      { key: 'dwell', label: 'Hold at depth', unit: 's', step: 0.5 },
      { key: 'retractSlow', label: 'Slow lift distance', unit: 'mm', step: 0.5 },
      { key: 'retractFeed', label: 'Slow lift speed', unit: 'mm/min', step: 10 },
    ] },
    { group: 'Travel', items: [
      { key: 'clearance', label: 'Clearance over the tallest insert', unit: 'mm', step: 1 },
      { key: 'minClear', label: 'Never travel below', unit: 'mm', step: 1 },
      { key: 'bedX', label: 'X travel from the fence', unit: 'mm', step: 10 },
      { key: 'bedY', label: 'Y travel from the fence', unit: 'mm', step: 10 },
      { key: 'park', label: 'Park when finished', type: 'bool' },
      { key: 'parkX', label: 'Park X', unit: 'mm', step: 10 },
      { key: 'parkY', label: 'Park Y', unit: 'mm', step: 10 },
      { key: 'rapidXY', label: 'Rapid speed X/Y', unit: 'mm/min', step: 100,
        help: 'Rapid speeds drive the time estimate and preview. Match them to your $110 and $112.' },
      { key: 'rapidZ', label: 'Rapid speed Z', unit: 'mm/min', step: 50 },
    ] },
    { group: 'Iron and clearances', items: [
      { key: 'ironFig', type: 'iron' },
      { key: 'ironTipD', label: 'Tip diameter', unit: 'mm', step: 0.5 },
      { key: 'ironTipL', label: 'Tip length below the nut', unit: 'mm', step: 1 },
      { key: 'ironNutD', label: 'Tip nut diameter', unit: 'mm', step: 0.5 },
      { key: 'ironNutL', label: 'Tip nut length', unit: 'mm', step: 1 },
      { key: 'ironBodyD', label: 'Iron body diameter', unit: 'mm', step: 0.5 },
      { key: 'carriageD', label: 'Z carriage width, 0 to ignore', unit: 'mm', step: 1 },
      { key: 'carriageZ', label: 'Carriage starts above the tip', unit: 'mm', step: 1 },
      { key: 'ironMargin', label: 'Extra clearance all round', unit: 'mm', step: 0.1 },
      { key: 'fenceH', label: 'Fence height', unit: 'mm', step: 1,
        help: 'The collision check looks for anything that would hit the iron at the bottom of each press: the part, the copies beside it, and the fence. Measure your iron with calipers; the defaults are a guess at a Pinecil V2 with a press tip.' },
    ] },
    { group: 'Touch-off', items: [
      { key: 'tripTravel', label: 'Float travel before the sensor trips', unit: 'mm', step: 0.05,
        help: 'Touch off Z on the machine panel lowers the tip until the float trips, then sets Z0 this far above that point.' },
      { key: 'touchFeed', label: 'Touch-off speed', unit: 'mm/min', step: 10 },
      { key: 'touchMax', label: 'Give up after', unit: 'mm', step: 5 },
    ] },
    { group: 'Holes and estimates', items: [
      { key: 'dMin', label: 'Smallest hole to find', unit: 'mm', step: 0.1 },
      { key: 'dMax', label: 'Largest hole to find', unit: 'mm', step: 0.1 },
      { key: 'wallMin', label: 'Plastic wanted outside the insert', unit: 'mm', step: 0.1 },
      { key: 'loadTime', label: 'Time to load one insert', unit: 's', step: 1 },
      { key: 'insertCost', label: 'Cost per insert', unit: '$', step: 0.01 },
    ] },
  ];
  const STEPS = ['part', 'holes', 'machine', 'preview'];
  const STEP_NAMES = { part: 'Part', holes: 'Holes', machine: 'Machine', preview: 'Preview' };
  const TIME_PARTS = [
    ['travel', 'Travel', '#6f9bb0'], ['rapidZ', 'Z moves', '#a3acb0'], ['press', 'Pressing', '#e8743f'],
    ['dwell', 'Holding', '#b6461f'], ['lift', 'Lifting', '#d9ab4f'], ['load', 'Loading', '#4c565b'],
  ];

  /* ---------- storage ---------- */
  const LS_KEY = 'insertpress.settings.v1';
  const PROF_KEY = 'insertpress.profiles.v1';
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage off */ } },
  };
  const loadSettings = () => Object.assign({}, IP.DEFAULT_SETTINGS, store.get(LS_KEY, {}));
  const saveSettings = () => store.set(LS_KEY, S.settings);

  const S = {
    raw: null, name: '', rot: { x: 0, y: 0, z: 0 }, scale: 1,
    part: null, hull: null, mstats: null,
    place: { x: 0, y: 0, rot: 0 }, copies: { nx: 1, ny: 1, gap: 6 },
    holes: [], ignored: [], order: [],
    settings: loadSettings(), profiles: store.get(PROF_KEY, {}), profile: store.get(PROF_KEY + '.current', ''),
    step: 'part', tool: 'select', view: 'iso',
    activeId: null, hoverId: null, shift: false,
    nextId: 1, result: null, pendingJob: null, hintedTool: false,
    sel: new Set(), runMarks: {}, live: null, measure: null, showIron: true, cindex: null,
    collide: new Set(), collideLocal: new Set(), collRes: new Map(),
  };
  const ui = {};
  if (S.profile && !S.profiles[S.profile]) S.profile = '';

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 5200 : 2800);
  }

  /* ---------- viewer ---------- */
  let dragBase = null;
  const handlers = {
    onPick, onHover,
    tool: () => S.tool,
    onMoveStart() { remember(); dragBase = Object.assign({}, S.place); },
    onMove(dx, dy) {
      if (!dragBase) return;
      const q = S.shift ? 0.1 : 0.5;
      S.place.x = Math.round((dragBase.x + dx) / q) * q;
      S.place.y = Math.round((dragBase.y + dy) / q) * q;
      livePlacement();
    },
    onMoveEnd() { dragBase = null; refresh(); },
    onMeasure(kind, pt) { measureEvent(kind, pt); },
    onBox(ids, add) { if (!S.part || !ui.holes) return; ui.holes.selectIds(ids, add); if (S.step !== 'holes') goStep('holes'); },
  };
  const has3D = !!(window.THREE && THREE.OrbitControls);
  let viewer;
  try { viewer = has3D ? new IP.Viewer($('viewport'), handlers) : new IP.Viewer2D($('viewport'), handlers); }
  catch (e) { console.error('3D view failed; using the top view instead.', e); $('viewport').innerHTML = ''; viewer = new IP.Viewer2D($('viewport'), handlers); }
  const is2D = viewer instanceof IP.Viewer2D;
  if (is2D) { $('view-seg').hidden = true; $('btn-xray').hidden = true; }
  const ironZones = () => IP.collision.zonesFrom(S.settings);
  const setBed = () => {
    viewer.setBed(S.settings.bedX, S.settings.bedY, S.settings.park ? { x: S.settings.parkX, y: S.settings.parkY } : null, S.settings.fenceH);
    viewer.setIron(ironZones());
  };
  setBed();

  /* ---------- history ---------- */
  const hist = { u: [], r: [] };
  const snap = () => JSON.stringify({ holes: S.holes, order: S.order, place: S.place, copies: S.copies, settings: S.settings, rot: S.rot, scale: S.scale, nextId: S.nextId });
  function remember() {
    if (!S.part) return;
    hist.u.push(snap());
    if (hist.u.length > 150) hist.u.shift();
    hist.r = [];
    updHist();
  }
  function updHist() { $('btn-undo').disabled = !hist.u.length; $('btn-redo').disabled = !hist.r.length; }
  function restore(js) {
    const o = JSON.parse(js);
    const geom = o.rot.x !== S.rot.x || o.rot.y !== S.rot.y || o.rot.z !== S.rot.z || o.scale !== S.scale;
    S.rot = o.rot; S.scale = o.scale;
    if (geom) { preparePart(); S.ignored = IP.holes.detect(S.part.positions, S.settings).ignored; }
    S.holes = o.holes; S.order = o.order; S.place = o.place; S.copies = o.copies; S.nextId = o.nextId;
    const settingsChanged = JSON.stringify(o.settings) !== JSON.stringify(S.settings);
    S.settings = o.settings;
    if (settingsChanged) { saveSettings(); renderSettings(); setBed(); }
    setUnitsUI();
    if (!S.holes.some((h) => h.id === S.activeId)) S.activeId = null;
    refresh();
    updHist();
  }
  function undo() { if (!hist.u.length) return; hist.r.push(snap()); restore(hist.u.pop()); toast('Undone.'); }
  function redo() { if (!hist.r.length) return; hist.u.push(snap()); restore(hist.r.pop()); toast('Redone.'); }

  /* ---------- steps & tools ---------- */
  function goStep(name) {
    S.step = name;
    $$('.step').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.step === name)));
    STEPS.forEach((s) => { $('pane-' + s).hidden = s !== name; });
    const i = STEPS.indexOf(name);
    $('btn-back').hidden = i === 0;
    const nb = $('btn-next');
    nb.hidden = i === STEPS.length - 1;
    if (i < STEPS.length - 1) nb.textContent = `Next: ${STEP_NAMES[STEPS[i + 1]]}`;
    nb.disabled = !S.part;
    nb.classList.toggle('primary', !!S.part && name === 'machine' && S.order.length > 0);
    $('panes').scrollTop = 0;
    if (name === 'preview') markCodeLine(true);
  }

  function setTool(t) {
    S.tool = t;
    $$('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    $('btn-add').setAttribute('aria-pressed', String(t === 'place'));
    const hint = $('add-hint');
    hint.hidden = t === 'select';
    if (t === 'place') hint.innerHTML = 'Click a flat top surface to place a hole. <kbd>Esc</kbd> to finish.';
    if (t === 'move') hint.innerHTML = 'Drag a part to move it. Snaps to 0.5 mm; hold <kbd>Shift</kbd> for 0.1 mm. Arrow keys nudge.';
    if (t === 'measure') hint.innerHTML = 'Click two points to measure. Snaps to hole centres and corners. <kbd>Esc</kbd> clears.';
    if (t !== 'select') $('tip-card').hidden = true;
    if (t !== 'measure') clearMeasure();
  }

  /* ---------- measure ---------- */
  const snapName = (p) => ({ hole: 'hole centre', corner: 'corner', surface: 'surface', bed: 'bed' }[p.snap] || 'point');
  function clearMeasure() { S.measure = null; viewer.setMeasure(null); $('measure-card').hidden = true; }
  function measureEvent(kind, pt) {
    const m = S.measure || (S.measure = { a: null, b: null, hover: null });
    if (kind === 'leave') m.hover = null;
    else if (kind === 'move') m.hover = pt;
    else if (kind === 'click' && pt) { if (!m.a || m.b) { m.a = pt; m.b = null; } else m.b = pt; }
    const b = m.b || (m.a && m.hover ? m.hover : null);
    viewer.setMeasure(m.a ? { a: m.a, b, hover: m.hover, live: !m.b } : null);
    const card = $('measure-card');
    if (m.a && b) {
      const mm = IP.measure.between(m.a, b);
      card.hidden = false;
      card.classList.toggle('live', !m.b);
      card.innerHTML = `<b>${IP.measure.label(mm)}</b><span class="m-d">${IP.measure.detail(mm)}</span><span class="m-s">${snapName(m.a)} to ${snapName(b)}</span>`;
    } else card.hidden = true;
  }

  /* ---------- loading ---------- */
  function readFile(file) {
    if (!file) return;
    const name = file.name || 'part.stl';
    const r = new FileReader();
    r.onerror = () => toast(`Could not read ${name}.`, true);
    if (/\.(json|ipjob)$/i.test(name)) { r.onload = () => openJob(r.result); r.readAsText(file); }
    else { r.onload = () => loadSTL(r.result, name); r.readAsArrayBuffer(file); }
  }

  function loadSTL(buf, name) {
    let raw;
    try { raw = IP.stl.parseSTL(buf); } catch (e) { toast(e.message, true); return; }
    if (!raw.length) { toast(`${name} has no triangles.`, true); return; }
    S.raw = raw;
    S.name = name.replace(/\.stl$/i, '');
    S.rot = { x: 0, y: 0, z: 0 };
    hist.u = []; hist.r = []; updHist();
    const pj = S.pendingJob;
    S.pendingJob = null;
    if (pj) { applyJob(pj); return; }
    S.place = { x: 0, y: 0, rot: 0 }; S.copies = { nx: 1, ny: 1, gap: S.copies.gap };
    rebuild();
    goStep('holes');
  }

  function loadExample(kind) {
    const bracket = kind === 'bracket';
    S.raw = bracket ? IP.exampleBracket() : IP.exampleBlock();
    S.name = bracket ? 'example-bracket' : 'example-block';
    S.rot = { x: 0, y: 0, z: 0 };
    S.scale = 1; setUnitsUI();
    S.place = { x: 0, y: 0, rot: 0 }; S.copies = { nx: 1, ny: 1, gap: 6 };
    hist.u = []; hist.r = []; updHist();
    rebuild();
    goStep('holes');
  }

  function preparePart() {
    S.part = IP.stl.preparePart(S.raw, { rot: S.rot, scale: S.scale });
    S.hull = IP.place.footprintHull(S.part.positions);
    S.mstats = IP.place.meshStats(S.part.positions);
    S.cindex = new IP.collision.Index(S.part.positions);
    viewer.setPart(S.part.positions, S.part.size);
    viewer.setInstances(insts());
    onPartReady();
  }

  function rebuild() {
    preparePart();
    S.holes = []; S.order = []; S.activeId = null;
    detect(false);
    fitView();
  }

  function onPartReady() {
    $('stage-empty').hidden = true;
    $('legend').hidden = false;
    $('view-tools').hidden = false;
    $('tool-rail').hidden = false;
    $('part-intro').hidden = true;
    $('part-loaded').hidden = false;
    $$('#btn-all, #btn-none, #btn-optimize, #btn-add, #btn-save-job, #btn-save-job-2').forEach((b) => { b.disabled = false; });
    $('btn-next').disabled = false;
  }

  const xyKey = (h) => Math.round(h.x * 20) + ':' + Math.round(h.y * 20);

  function detect(keep) {
    if (!S.part) return;
    const res = IP.holes.detect(S.part.positions, { dMin: S.settings.dMin, dMax: S.settings.dMax });
    const old = keep ? new Map(S.holes.filter((h) => h.source === 'auto').map((h) => [xyKey(h), h])) : new Map();
    const manual = keep ? S.holes.filter((h) => h.source === 'manual') : [];
    const auto = res.holes.map((r) => {
      const prev = old.get(xyKey(r));
      return {
        id: prev ? prev.id : S.nextId++, source: 'auto',
        x: r.x, y: r.y, H: r.top, dia: r.dia, depth: r.depth, blind: r.blind, wall: r.wall,
        insert: prev ? prev.insert : IP.gcode.guessInsert(r.dia, 'm3'),
        sink: prev ? prev.sink : null,
      };
    });
    S.holes = auto.concat(manual);
    const ids = new Set(S.holes.map((h) => h.id));
    S.order = S.order.filter((id) => ids.has(id));
    S.ignored = res.ignored;
    if (!keep && !auto.length) toast('No insert-sized holes face up. Turn the part, widen the size range, or place holes by hand.');
    refresh();
  }

  /* ---------- geometry helpers ---------- */
  const byId = (id) => S.holes.find((h) => h.id === id);
  const insts = () => (S.hull ? IP.place.instances(S.hull, S.place, S.copies) : [{ i: 0, rot: 0, tx: 0, ty: 0 }]);
  const arrayBox = () => IP.place.arrayBounds(S.hull, S.place, S.copies);
  const frameBox = () => { const b = arrayBox(); return { x: b.x, y: b.y, w: b.w, h: b.h, z: S.part.size.z }; };
  function fitView() { if (S.part) viewer.frame(S.view, frameBox()); }

  /** Holes in press order for every copy, in machine coordinates. */
  function worldHoles() {
    const list = insts();
    const out = [];
    const n = S.order.length;
    for (const inst of list) {
      S.order.forEach((id, idx) => {
        const h = byId(id);
        if (!h) return;
        const w = IP.place.toWorld(inst, h.x, h.y);
        out.push({ x: w.x, y: w.y, H: h.H, dia: h.dia, depth: h.depth, blind: h.blind, wall: h.wall,
          insert: h.insert, sink: h.sink, label: String(inst.i * n + idx + 1), copy: inst.i, localId: id });
      });
    }
    return out;
  }

  /* ---------- picking & hover ---------- */
  function onPick(p) {
    if (!S.part) return;
    if (p.type === 'hole') {
      if (p.shift || p.toggle) ui.holes.select(p.id, { toggle: true });
      else toggleOrder(p.id);
      if (S.step !== 'holes') goStep('holes');
      return;
    }
    if (S.tool !== 'place') {
      if (S.sel.size && !p.shift && !p.toggle) { ui.holes.clearSel(); return; }
      if (p.type === 'surface' && !S.hintedTool) { S.hintedTool = true; toast('Click a ring to press it. Shift-click or Shift-drag to select. Place (H) adds a hole.'); }
      return;
    }
    if (p.type !== 'surface' || p.normalZ < 0.9) { toast('That spot is not a flat, upward face of the part. Pick a top face.', true); return; }
    const inst = insts()[p.inst || 0];
    const loc = IP.place.toLocal(inst, p.point.x, p.point.y);
    if (S.holes.some((h) => Math.hypot(h.x - loc.x, h.y - loc.y) < 1.5)) { toast('There is already a hole there.'); return; }
    remember();
    const h = { id: S.nextId++, source: 'manual', x: loc.x, y: loc.y, H: p.point.z, dia: null, depth: null, blind: false, wall: null,
      insert: S.settings.defaultInsert, sink: null };
    S.holes.push(h);
    S.order.push(h.id);
    S.activeId = h.id;
    refresh();
    if (S.step !== 'holes') goStep('holes');
  }

  function onHover(id, cx, cy) {
    const card = $('tip-card');
    if (id == null || S.tool === 'move') {
      card.hidden = true;
    } else {
      const h = byId(id);
      if (h) {
        const idx = S.order.indexOf(id);
        const ins = IP.INSERTS[h.insert];
        const copies = insts().length;
        card.innerHTML = `<b>${idx >= 0 ? 'Hole ' + (idx + 1) + (copies > 1 ? ` <span class="fine">on each of ${copies} copies</span>` : '') : 'Not pressed'}</b>
          <div>${h.source === 'manual' ? 'Placed by hand' : '⌀' + f2(h.dia) + ' mm, ' + (h.blind ? fmt(h.depth) + ' mm deep' : 'through')}</div>
          <div>${esc(ins.name)} insert${h.wall != null ? `, ${f1(h.wall)} mm wall` : ''}</div>
          <div class="act">${idx >= 0 ? 'Click to take out' : 'Click to press'}</div>`;
        card.hidden = false;
        const pad = 16, w = card.offsetWidth, hh = card.offsetHeight;
        let left = cx + pad, top = cy + pad;
        if (left + w > window.innerWidth - 8) left = cx - w - pad;
        if (top + hh > window.innerHeight - 8) top = cy - hh - pad;
        card.style.left = left + 'px';
        card.style.top = top + 'px';
      }
    }
    if (id !== S.hoverId) { S.hoverId = id; updateView(); markHoverRow(); }
  }

  function toggleOrder(id) {
    if (!byId(id)) return; // stale marker or unknown id
    remember();
    const i = S.order.indexOf(id);
    if (i >= 0) { S.order.splice(i, 1); if (S.activeId === id) S.activeId = null; }
    else { S.order.push(id); S.activeId = id; }
    refresh();
  }

  function setUnitsUI() { $$('[data-units]').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.units === S.scale))); }

  /* ---------- rendering ---------- */
  const insertOptions = (sel) => Object.entries(IP.INSERTS)
    .map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v.name)}</option>`).join('');

  function refresh() {
    if (S.order.some((id) => !byId(id))) S.order = S.order.filter((id) => byId(id));
    renderPart();
    regen();
    renderHoles();
    renderPreview();
    updateView();
    $('btn-next').classList.toggle('primary', S.step === 'machine' && S.order.length > 0);
    const done = { part: !!S.part, holes: S.order.length > 0 };
    $$('.step').forEach((b) => b.classList.toggle('done', !!done[b.dataset.step] && b.dataset.step !== S.step));
  }

  function livePlacement() {
    viewer.setInstances(insts());
    updateView(true);
    renderPlacement();
  }

  function renderPart() {
    if (!S.part) return;
    const s = S.part.size, m = S.mstats;
    $('part-name').textContent = S.name;
    $('part-sub').textContent = `${S.part.triCount.toLocaleString()} triangles, ${S.holes.filter((h) => h.source === 'auto').length} insert holes found`;
    const cells = [
      [f2(s.x), 'width X, mm'], [f2(s.y), 'depth Y, mm'], [f2(s.z), 'height Z, mm'],
      [f2(m.volume / 1000), 'volume, cm³'], [f1(m.area / 100), 'surface, cm²'], [fmt(S.scale === 1 ? 1 : 25.4), S.scale === 1 ? 'scale, mm' : 'scale, inch→mm'],
    ];
    $('part-stats').innerHTML = cells.map(([b, sp]) => `<div><b>${b}</b><span>${sp}</span></div>`).join('');
    $('file-chip').hidden = false;
    $('file-chip').textContent = `${S.name}.stl`;
    renderPlacement();
  }

  function renderPlacement() {
    if (!S.part) return;
    const set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    set('pos-x', fmt(S.place.x)); set('pos-y', fmt(S.place.y)); set('pos-rot', fmt(S.place.rot));
    set('cp-nx', S.copies.nx); set('cp-ny', S.copies.ny); set('cp-gap', fmt(S.copies.gap));
    const b = arrayBox();
    const n = S.copies.nx * S.copies.ny;
    const fits = b.x >= -0.01 && b.y >= -0.01 && b.x + b.w <= S.settings.bedX + 0.01 && b.y + b.h <= S.settings.bedY + 0.01;
    const el = $('array-info');
    el.classList.toggle('warn', !fits);
    el.innerHTML = `${n > 1 ? `<b>${n} parts</b>, ` : ''}footprint <b>${f1(b.w)} × ${f1(b.h)} mm</b>, ends at X ${f1(b.x + b.w)} Y ${f1(b.y + b.h)}. `
      + (fits ? `Fits the ${S.settings.bedX} × ${S.settings.bedY} mm travel.` : `Runs past the ${S.settings.bedX} × ${S.settings.bedY} mm travel.`);
  }

  function holeMeta(h) {
    if (h.source === 'manual') return `Placed by hand, surface Z ${f2(h.H)}`;
    const kind = h.blind ? `${fmt(h.depth)} mm deep` : 'through';
    return `⌀${f2(h.dia)}, ${kind}, top Z ${f2(h.H)}`;
  }

  function inspector(h) {
    const ins = IP.INSERTS[h.insert];
    const sink = h.sink != null ? h.sink : S.settings.sink;
    const need = h.dia ? (ins.od - h.dia) / 2 + S.settings.wallMin : null;
    const w = IP.place.toWorld(insts()[0], h.x, h.y);
    const cell = (label, val, bad) => `<div class="${bad ? 'bad' : ''}"><span>${label}</span><b>${val}</b></div>`;
    return `<div class="insp">
      ${cell('Measured', h.dia ? '⌀' + f2(h.dia) : 'n/a')}
      ${cell(ins.name + ' wants', '⌀' + f2(ins.hole), h.dia && Math.abs(h.dia - ins.hole) > 0.4)}
      ${cell('Knurl OD', '⌀' + f2(ins.od))}
      ${cell('Depth', h.blind ? f2(h.depth) : h.depth ? 'through' : 'n/a', h.blind && h.depth < ins.L + 0.3)}
      ${cell('Insert length', f2(ins.L))}
      ${cell('Wall', h.wall != null ? f2(h.wall) : 'n/a', need != null && h.wall != null && h.wall < need)}
      ${(() => { const cr = S.collRes.get('c0:' + h.id); const t = !cr ? 'n/a' : cr.hits.length ? 'hits ' + cr.hits[0].zone.name : cr.clearance == null ? 'clear' : f1(cr.clearance) + ' mm'; return cell('Iron clearance', t, cr && cr.hits.length); })()}
      ${cell('Bed X, Y', f1(w.x) + ', ' + f1(w.y))}
      ${cell('Press to', 'Z ' + f2(h.H - sink))}
    </div>
    <label class="sink">Finish below surface
      <input type="number" step="0.05" data-sink="${h.id}" value="${h.sink != null ? h.sink : ''}" placeholder="${fmt(S.settings.sink)}"> mm</label>`;
  }

  const xyHTML = (x, y) => `<div class="xy"><i>X</i><span>${f2(x)}</span><i>Y</i><span>${f2(y)}</span></div>`;

  function renderHoles() {
    if (ui.holes) ui.holes.render();
    const big = S.ignored.filter((i) => i.reason === 'size').length;
    const blocked = S.ignored.filter((i) => i.reason === 'blocked').length;
    const parts = [];
    if (big) parts.push(`${big} round hole${big === 1 ? '' : 's'} outside ${fmt(S.settings.dMin)}–${fmt(S.settings.dMax)} mm`);
    if (blocked) parts.push(`${blocked} that open${blocked === 1 ? 's' : ''} downward`);
    $('ignored-note').textContent = parts.length ? `Skipped ${parts.join(' and ')}. Change the size range on the Machine step.` : '';
    const copies = insts().length;
    $('count-line').innerHTML = S.part
      ? (S.holes.length
        ? `<b>${S.order.length}</b> of ${S.holes.length} hole${S.holes.length === 1 ? '' : 's'} in the press order${copies > 1 && S.order.length ? `, <b>${S.order.length * copies}</b> across ${copies} copies` : ''}`
        : 'No insert holes found. Use Place (H), or turn the part.')
      : 'Open a part first.';
    const pill = $('pill-holes');
    pill.hidden = !S.order.length;
    pill.textContent = S.order.length * copies;
    $('status').textContent = S.part
      ? (is2D ? 'Top view. Drag to pan, scroll to zoom, Shift-drag to select. The 3D view needs an internet connection.'
        : 'Drag to orbit, right-drag to pan, scroll to zoom, Shift-drag to select.')
      : '';
    markHoverRow();
  }

  function markHoverRow() {
    $$('.hole').forEach((li) => {
      const id = +(li.dataset.id || li.dataset.add);
      li.classList.toggle('hover', id === S.hoverId);
    });
  }

  function updateView() {
    if (!S.part) return;
    const list = insts();
    const n = S.order.length;
    const markers = [];
    for (const inst of list) {
      for (const h of S.holes) {
        const idx = S.order.indexOf(h.id);
        const w = IP.place.toWorld(inst, h.x, h.y);
        const label = idx >= 0 ? String(inst.i * n + idx + 1) : null;
        markers.push({ key: inst.i + ':' + h.id, id: h.id, x: w.x, y: w.y, H: h.H, depth: h.depth,
          dia: h.dia || IP.INSERTS[h.insert].hole, used: idx >= 0, label,
          active: h.id === S.activeId || h.id === S.hoverId, sel: S.sel.has(h.id),
          bad: label != null ? S.collide.has(label) : S.collideLocal.has(h.id),
          run: label != null ? S.runMarks[label] || null : null });
      }
    }
    viewer.setHoles(markers);
    // iron envelope at the hovered or open hole
    const gid = S.hoverId != null ? S.hoverId : S.activeId;
    const gh = gid != null && S.showIron ? byId(gid) : null;
    if (gh) {
      const w = IP.place.toWorld(list[0], gh.x, gh.y);
      const res = S.collRes.get('c0:' + gh.id);
      const zones = ironZones();
      viewer.setGhost({ x: w.x, y: w.y, z: gh.H - (gh.sink != null ? gh.sink : S.settings.sink), margin: S.settings.ironMargin,
        hit: res ? res.hits.map((x) => zones.findIndex((z) => z.key === x.zone.key)) : [] });
    } else viewer.setGhost(null);
    const r = S.result;
    if (r && r.moves.length && S.settings.mode === 'xy') {
      const pts = [r.moves[0].from];
      for (const m of r.moves) pts.push(m.to);
      viewer.setPath(pts);
    } else viewer.setPath(null);
  }

  /* ---------- G-code & preview ---------- */
  let codeEls = [];
  function regen() {
    if (!S.part) return;
    S.result = IP.gcode.generate({ name: S.name, partTop: S.part.size.z, copies: insts().length, holes: worldHoles(), settings: S.settings });
    S.result.issues = collisions().concat(S.result.issues);
    const r = S.result;
    const errors = r.issues.filter((i) => i.level === 'error');
    const canExport = !!r.text && !errors.length;
    ['btn-export', 'btn-export-2'].forEach((id) => {
      $(id).disabled = !canExport;
      $(id).title = errors.length ? 'Fix the errors on the Preview step first' : '';
    });
    $('btn-copy').disabled = !r.text;
    $('btn-template').disabled = !S.order.length;
    $('btn-air').disabled = !r.text;
    $('btn-run-machine').disabled = !S.order.length;
    const pill = $('pill-issues');
    pill.hidden = !r.issues.length;
    pill.textContent = r.issues.length;

    // code with line numbers
    const code = $('code');
    if (!r.text) {
      code.innerHTML = '<span class="ln c">; Add at least one hole to the press order.</span>';
      codeEls = [];
      $('code-lines').textContent = '';
    } else {
      const lines = r.text.trimEnd().split('\n');
      $('code-lines').textContent = `${lines.length} lines`;
      code.innerHTML = lines.map((l) => {
        const [cmd, ...rest] = l.split(';');
        const note = rest.join(';');
        const comment = rest.length ? `<span class="c">;${esc(note)}</span>` : '';
        let cls = '';
        if (/^\(MSG|^M0/.test(cmd)) cls = 'm';
        else if (/press/.test(note)) cls = 'g';
        return `<span class="ln">${cls ? `<span class="${cls}">${esc(cmd)}</span>` : esc(cmd)}${comment}</span>`;
      }).join('');
      codeEls = Array.from(code.children);
    }

    // timeline
    const has = r.moves.length > 0;
    $('timeline').hidden = !has || !!S.live;
    $('stage').classList.toggle('has-timeline', has && !S.live);
    if (!has) { simStop(); viewer.setTip(null); }
    else simSet(Math.min(sim.t, r.seconds));
  }

  /** Iron collision check for every hole on every copy; issues only for holes being pressed. */
  function collisions() {
    S.collide = new Set(); S.collideLocal = new Set(); S.collRes = new Map();
    if (!S.part || !S.cindex) return [];
    const list = insts(), n = S.order.length, all = [];
    for (const inst of list) for (const h of S.holes) {
      const idx = S.order.indexOf(h.id);
      const w = IP.place.toWorld(inst, h.x, h.y);
      all.push({ x: w.x, y: w.y, H: h.H, sink: h.sink, label: idx >= 0 ? String(inst.i * n + idx + 1) : 'u' + h.id, localId: h.id, copy: inst.i, used: idx >= 0 });
    }
    const res = IP.collision.check(all, { index: S.cindex, instances: list, partSize: S.part.size, zones: ironZones(),
      margin: S.settings.ironMargin, sink: S.settings.sink, fenceH: S.settings.fenceH });
    const used = [];
    res.forEach((r, i) => {
      S.collRes.set('c' + r.copy + ':' + r.localId, r);
      if (!r.hits.length) return;
      if (all[i].used) { S.collide.add(r.label); used.push(r); } else if (r.copy === 0) S.collideLocal.add(r.localId);
    });
    return IP.collision.issues(used);
  }

  function renderPreview() {
    const r = S.result;
    if (!r || !r.stats) {
      $('time-big').textContent = '–';
      $('time-sub').textContent = 'Add holes to see the job time.';
      $('time-bar').innerHTML = ''; $('time-legend').innerHTML = ''; $('stats').innerHTML = ''; $('bom').innerHTML = '';
      $('issues').innerHTML = '';
      return;
    }
    const st = r.stats, T = st.time, total = r.seconds || 1;
    $('time-big').textContent = fmtTime(r.seconds);
    $('time-sub').textContent = `Job time, with ${fmt(S.settings.loadTime)} s to load each insert. The machine moves for ${fmtLong(st.machineSeconds)}.`;
    $('time-bar').innerHTML = TIME_PARTS.map(([k, , col]) => (T[k] > 0 ? `<i style="width:${(T[k] / total) * 100}%;background:${col}" title="${k}"></i>` : '')).join('');
    $('time-legend').innerHTML = TIME_PARTS.map(([k, label, col]) => `<li><i style="background:${col}"></i>${label}<b>${fmtTime(T[k])}</b></li>`).join('');
    const copies = insts().length;
    const perPart = st.inserts ? r.seconds / copies : 0;
    $('stats').innerHTML = [
      [st.inserts, 'inserts'], [copies, copies === 1 ? 'part' : 'parts'], [fmtTime(perPart), 'per part'],
      [st.travelDist >= 1000 ? f2(st.travelDist / 1000) + ' m' : Math.round(st.travelDist) + ' mm', 'X/Y travel'],
      ['Z ' + fmt(r.clearZ), 'travel height'], [st.lines, 'G-code lines'],
    ].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('');
    const rows = Object.entries(st.bom).map(([name, q]) => `<tr><td>${esc(name)} heat-set insert</td><td>${q}</td><td>$${(q * S.settings.insertCost).toFixed(2)}</td></tr>`).join('');
    $('bom').innerHTML = `<tr><th>Item</th><th>Qty</th><th>Cost</th></tr>${rows}<tr class="total"><td>Total</td><td>${st.inserts}</td><td>$${st.cost.toFixed(2)}</td></tr>`;
    const iss = r.issues;
    const shown = iss.slice(0, 10).map((i) => `<li class="${i.level}">${esc(i.text)}</li>`).join('');
    $('issues').innerHTML = shown + (iss.length > 10 ? `<li>And ${iss.length - 10} more like these.</li>` : '');
  }

  /* ---------- simulation ---------- */
  const sim = { t: 0, playing: false, speed: 4, last: 0, line: -1 };
  function simSet(t) {
    const r = S.result;
    if (!r || !r.moves.length) return;
    sim.t = clamp(t, 0, r.seconds);
    const smp = IP.gcode.sample(r.moves, sim.t);
    const m = smp.move;
    if (!S.live) viewer.setTip(smp.pos, m.kind);
    $('sim-range').value = String(Math.round((sim.t / (r.seconds || 1)) * 1000));
    $('sim-time').textContent = `${fmtTime(sim.t)} / ${fmtTime(r.seconds)}`;
    const total = r.stats.inserts;
    const hn = m.hole != null ? `<b>hole ${m.hole}</b> of ${total}` : '';
    const what = {
      travel: () => `Moving to ${hn}`,
      rapid: () => (m.to[2] < m.from[2] ? `Dropping to ${hn || 'start'}` : `Raising${hn ? ' from ' + hn : ''}`),
      press: () => `Pressing ${hn}`,
      dwell: () => `Holding ${hn}`,
      lift: () => `Easing off ${hn}`,
      pause: () => (m.hole != null ? `Paused: load ${hn}` : 'Paused: waiting for Cycle Start'),
    }[m.kind];
    $('sim-what').innerHTML = sim.t <= 1e-6 ? 'Ready. Press play to watch the job.' : sim.t >= r.seconds - 1e-6 ? 'Done' : what ? what() : '';
    $('sim-xyz').innerHTML = `X ${f2(smp.pos[0])}<br>Y ${f2(smp.pos[1])}<br>Z ${f2(smp.pos[2])}`;
    if (m.line !== sim.line) { sim.line = m.line; markCodeLine(false); }
  }
  function markCodeLine(force) {
    const code = $('code');
    code.querySelectorAll('.ln.now').forEach((n) => n.classList.remove('now'));
    const el = codeEls[sim.line];
    if (!el) return;
    el.classList.add('now');
    if (S.step === 'preview' && (sim.playing || force)) {
      const top = el.offsetTop - code.clientHeight / 2;
      code.scrollTop = Math.max(0, top);
    }
  }
  function simLoop(ts) {
    if (!sim.playing) return;
    const dt = sim.last ? ((ts - sim.last) / 1000) * sim.speed : 0;
    sim.last = ts;
    simSet(sim.t + dt);
    if (sim.t >= S.result.seconds - 1e-6) { simStop(); return; }
    requestAnimationFrame(simLoop);
  }
  function simPlay() {
    if (!S.result || !S.result.moves.length) return;
    if (sim.t >= S.result.seconds - 1e-6) sim.t = 0;
    sim.playing = true; sim.last = 0;
    $('sim-play').classList.add('on');
    requestAnimationFrame(simLoop);
  }
  function simStop() { sim.playing = false; $('sim-play').classList.remove('on'); }

  /* ---------- export ---------- */
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function exportGcode() {
    if (!S.result || !S.result.text) return;
    download(`${S.name}.gcode`, S.result.text, 'text/plain');
    toast(`Downloaded ${S.name}.gcode`);
  }

  /** 1:1 placement template. Its bottom-left corner goes in the fence corner. */
  function buildTemplate() {
    const list = insts();
    const ab = arrayBox();
    const W = Math.ceil(Math.max(ab.x + ab.w, 80) + 14);
    const H = Math.ceil(Math.max(ab.y + ab.h, 60) + 30);
    const Y = (y) => (H - y).toFixed(2);
    const X = (x) => x.toFixed(2);
    const o = [];
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`);
    o.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
    for (let x = 10; x < W; x += 10) o.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${x % 50 ? '#eee' : '#d8d8d8'}" stroke-width="0.2"/>`);
    for (let y = 10; y < H; y += 10) o.push(`<line x1="0" y1="${Y(y)}" x2="${W}" y2="${Y(y)}" stroke="${y % 50 ? '#eee' : '#d8d8d8'}" stroke-width="0.2"/>`);
    o.push(`<path d="M0.4 ${H - 40} V${H - 0.4} H40" fill="none" stroke="#000" stroke-width="0.8"/>`);
    o.push(`<text x="3" y="${H - 3}" font-size="2.6">Fence corner (X0 Y0)</text>`);
    list.forEach((inst) => {
      const pts = S.hull.map(([x, y]) => { const w = IP.place.toWorld(inst, x, y); return `${X(w.x)},${Y(w.y)}`; }).join(' ');
      o.push(`<polygon points="${pts}" fill="#f6edda" stroke="#8a6420" stroke-width="0.35"/>`);
      const c = IP.place.toWorld(inst, S.part.size.x / 2, S.part.size.y / 2);
      if (list.length > 1) o.push(`<text x="${X(c.x)}" y="${Y(c.y)}" font-size="3.2" fill="#8a6420" text-anchor="middle">Copy ${inst.i + 1}</text>`);
    });
    worldHoles().forEach((h) => {
      const r = (h.dia || IP.INSERTS[h.insert].hole) / 2;
      o.push(`<circle cx="${X(h.x)}" cy="${Y(h.y)}" r="${r.toFixed(2)}" fill="none" stroke="#000" stroke-width="0.25"/>`);
      o.push(`<path d="M${X(h.x - r - 1.5)} ${Y(h.y)} H${X(h.x + r + 1.5)} M${X(h.x)} ${Y(h.y - r - 1.5)} V${Y(h.y + r + 1.5)}" stroke="#000" stroke-width="0.15"/>`);
      o.push(`<text x="${X(h.x + r + 0.8)}" y="${(H - h.y - r - 0.6).toFixed(2)}" font-size="2.4">${h.label}</text>`);
    });
    const sy = 8;
    o.push(`<path d="M10 ${sy} H60 M10 ${sy - 2} V${sy + 2} M60 ${sy - 2} V${sy + 2}" stroke="#000" stroke-width="0.4"/>`);
    o.push(`<text x="62" y="${sy + 1}" font-size="2.8">50 mm. Measure this after printing at 100%.</text>`);
    o.push(`<text x="10" y="${sy + 8}" font-size="3.4" font-weight="bold">${esc(S.name)}: ${worldHoles().length} inserts, ${list.length} part${list.length > 1 ? 's' : ''}</text>`);
    o.push('</svg>');
    return o.join('\n');
  }

  /* ---------- jobs ---------- */
  function saveJob() {
    if (!S.part) return;
    const job = {
      format: 'insertpress-job', version: 4,
      part: { name: S.name, triangles: S.part.triCount, rot: S.rot, scale: S.scale },
      place: S.place, copies: S.copies, settings: S.settings,
      holes: S.holes, order: S.order,
    };
    download(`${S.name}.ipjob.json`, JSON.stringify(job, null, 2), 'application/json');
    toast('Saved job file.');
  }

  function openJob(text) {
    let job;
    try { job = JSON.parse(text); } catch (e) { toast('That job file is not valid JSON.', true); return; }
    if (job.format !== 'insertpress-job') { toast('That file is not an InsertPress job.', true); return; }
    if (!S.raw || (job.part && S.raw.length / 9 !== job.part.triangles)) {
      S.pendingJob = job;
      toast(`Job loaded. Now open ${job.part ? job.part.name + '.stl' : 'its STL'}.`);
      return;
    }
    applyJob(job);
  }

  function applyJob(job) {
    if (job.part && S.raw.length / 9 !== job.part.triangles) {
      toast('This STL has a different triangle count than the job expects. Holes may not line up.', true);
    }
    S.settings = Object.assign({}, IP.DEFAULT_SETTINGS, job.settings || {});
    saveSettings(); renderSettings(); setBed();
    S.rot = (job.part && job.part.rot) || { x: 0, y: 0, z: 0 };
    S.scale = (job.part && job.part.scale) || 1; setUnitsUI();
    S.place = Object.assign({ x: 0, y: 0, rot: 0 }, job.place || {});
    S.copies = Object.assign({ nx: 1, ny: 1, gap: 6 }, job.copies || {});
    preparePart();
    S.holes = (job.holes || []).map((h) => Object.assign({}, h));
    S.order = (job.order || []).filter((id) => S.holes.some((h) => h.id === id));
    S.nextId = Math.max(0, ...S.holes.map((h) => h.id)) + 1;
    S.ignored = [];
    detect(true);
    fitView();
    goStep('holes');
    toast('Opened job.');
  }

  /* ---------- settings & profiles ---------- */
  function renderSettings() {
    const s = S.settings;
    $('settings-form').innerHTML = SCHEMA.map((g) => `<div class="group"><h3>${g.group}</h3>${g.items.map((it) => {
      if (it.type === 'iron') return '<div class="iron-fig" id="iron-fig" aria-label="Iron profile, drawn to scale"></div>';
      const id = 'set-' + it.key;
      const help = it.help ? `<div class="help">${esc(it.help)}</div>` : '';
      let ctl;
      if (it.type === 'select' || it.type === 'insert' || it.type === 'material') {
        let opts;
        if (it.type === 'insert') opts = insertOptions(s[it.key]);
        else if (it.type === 'material') opts = Object.entries(IP.MATERIALS).map(([k, m]) => `<option value="${k}"${k === s[it.key] ? ' selected' : ''}>${m.name}</option>`).join('');
        else opts = it.options.map(([v, l]) => `<option value="${v}"${v === s[it.key] ? ' selected' : ''}>${esc(l)}</option>`).join('');
        ctl = `<select id="${id}" data-key="${it.key}">${opts}</select>`;
      } else if (it.type === 'bool') {
        ctl = `<span class="switch"><input type="checkbox" role="switch" id="${id}" data-key="${it.key}"${s[it.key] ? ' checked' : ''}><span></span></span>`;
      } else {
        ctl = `<span class="num-in"><input type="number" id="${id}" data-key="${it.key}" step="${it.step}" value="${s[it.key]}"><span>${it.unit}</span></span>`;
      }
      return `<div class="set"><label for="${id}">${it.label}</label>${ctl}${help}</div>`;
    }).join('')}</div>`).join('') + '<button class="btn small" id="btn-reset">Restore defaults</button>';
    renderProfiles();
    drawIron();
  }

  /** Side view of the iron, to scale, from the collision zones. */
  function drawIron() {
    const el = $('iron-fig');
    if (!el) return;
    const z = ironZones();
    const top = z[z.length - 1].from + 26;
    const maxD = Math.max(...z.map((q) => q.d)) + 2 * S.settings.ironMargin;
    const W = 320, H = 180, sc = Math.min((H - 34) / top, 118 / maxD), cx = 74;
    const Y = (mm) => H - 18 - mm * sc;
    const fills = { tip: '#b9c0c3', nut: '#8d969a', body: '#3a4449', carriage: '#56646b' };
    const o = [`<svg viewBox="0 0 ${W} ${H}" role="img">`];
    o.push(`<path d="M8 ${Y(0)} H${W - 8}" stroke="#8a9296" stroke-width="1.5"/>`);
    for (let x = 12; x < W - 8; x += 8) o.push(`<path d="M${x} ${Y(0) + 1} l-5 6" stroke="#c4c9cb" stroke-width="1"/>`);
    o.push(`<text x="${W - 10}" y="${Y(0) - 5}" text-anchor="end" class="f">part surface</text>`);
    z.forEach((q, i) => {
      const to = z[i + 1] ? z[i + 1].from : top, r = (q.d / 2) * sc, m = S.settings.ironMargin * sc;
      o.push(`<rect x="${cx - r - m}" y="${Y(to)}" width="${2 * (r + m)}" height="${(to - q.from) * sc}" fill="none" stroke="#c09036" stroke-dasharray="3 3" stroke-width="1"/>`);
      o.push(`<rect x="${cx - r}" y="${Y(to)}" width="${2 * r}" height="${(to - q.from) * sc}" fill="${fills[q.key]}" rx="${i ? 1.5 : 0}"/>`);
      const ty = Y((q.from + Math.min(to, q.from + 40)) / 2);
      o.push(`<path d="M${cx + maxD / 2 * sc + 6} ${ty} H${cx + maxD / 2 * sc + 18}" stroke="#a9b0b2"/>`);
      o.push(`<text x="${cx + maxD / 2 * sc + 22}" y="${ty - 2}" class="n">${q.name.replace(/^./, (c) => c.toUpperCase())}, ⌀${fmt(q.d)}</text>`);
      o.push(`<text x="${cx + maxD / 2 * sc + 22}" y="${ty + 12}" class="f">from ${fmt(q.from)} mm up</text>`);
    });
    o.push('</svg>');
    el.innerHTML = o.join('');
  }

  function renderProfiles() {
    const names = Object.keys(S.profiles).sort();
    const dirty = S.profile && JSON.stringify(S.profiles[S.profile]) !== JSON.stringify(S.settings);
    const opts = [];
    if (!S.profile) opts.push('<option value="" selected>Unsaved settings</option>');
    for (const n of names) opts.push(`<option value="${esc(n)}"${n === S.profile ? ' selected' : ''}>${esc(n)}${n === S.profile && dirty ? ' (edited)' : ''}</option>`);
    $('profile-select').innerHTML = opts.join('');
    $('btn-profile-del').disabled = !S.profile;
  }

  function onSetting(e) {
    const el = e.target;
    const key = el.dataset.key;
    if (!key) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') { v = parseFloat(el.value); if (!isFinite(v)) return; }
    else v = el.value;
    remember();
    S.settings[key] = v;
    if (key === 'material') {
      const m = IP.MATERIALS[v];
      Object.assign(S.settings, { tipTemp: m.tipTemp, pressFeed: m.pressFeed, dwell: m.dwell });
      renderSettings();
      toast(`${m.name}: iron ${m.tipTemp} °C, press ${m.pressFeed} mm/min, hold ${m.dwell} s.`);
    }
    saveSettings();
    if (/^(bed|park|fence|iron|carriage)/.test(key)) { setBed(); drawIron(); }
    renderProfiles();
    if (key === 'dMin' || key === 'dMax') { detect(true); return; }
    refresh();
  }

  /* ---------- events ---------- */
  $('file-stl').addEventListener('change', (e) => { readFile(e.target.files[0]); e.target.value = ''; });
  $('file-job').addEventListener('change', (e) => { readFile(e.target.files[0]); e.target.value = ''; });
  $('btn-example').addEventListener('click', () => loadExample('block'));
  $('btn-example-2').addEventListener('click', () => loadExample('bracket'));
  $('btn-air').addEventListener('click', () => {
    const r = IP.gcode.generate({ name: S.name, partTop: S.part.size.z, copies: insts().length, holes: worldHoles(), settings: S.settings, air: 20 });
    download(`${S.name}-air-pass.gcode`, r.text, 'text/plain');
    toast(`Downloaded the air pass: every Z is 20 mm higher, so nothing touches the part.`);
  });
  $('btn-run-machine').addEventListener('click', () => ui.machine.open(true));
  ['btn-save-job', 'btn-save-job-2'].forEach((id) => $(id).addEventListener('click', saveJob));
  ['btn-export', 'btn-export-2'].forEach((id) => $(id).addEventListener('click', exportGcode));
  $('btn-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(S.result.text); toast('Copied G-code.'); }
    catch (e) { toast('Copy is blocked here. Use Download G-code instead.', true); }
  });
  $('btn-template').addEventListener('click', () => {
    download(`${S.name}-template.svg`, buildTemplate(), 'image/svg+xml');
    toast('Downloaded the placement template. Print it at 100% scale.');
  });
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);

  $$('.step').forEach((b) => b.addEventListener('click', () => goStep(b.dataset.step)));
  $('btn-next').addEventListener('click', () => goStep(STEPS[Math.min(STEPS.indexOf(S.step) + 1, STEPS.length - 1)]));
  $('btn-back').addEventListener('click', () => goStep(STEPS[Math.max(STEPS.indexOf(S.step) - 1, 0)]));
  $$('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

  // orientation & units
  $$('[data-rot]').forEach((b) => b.addEventListener('click', () => {
    if (!S.raw) return;
    remember();
    const had = S.order.length;
    S.rot[b.dataset.rot] = (S.rot[b.dataset.rot] + 1) % 4;
    rebuild();
    const n = S.holes.length;
    toast(`${n} hole${n === 1 ? '' : 's'} face up now.${had ? ' The press order was cleared; Undo brings it back.' : ''}`);
  }));
  $$('[data-units]').forEach((b) => b.addEventListener('click', () => {
    const v = +b.dataset.units;
    if (v === S.scale) return;
    remember();
    S.scale = v; setUnitsUI();
    if (S.raw) rebuild();
  }));

  // placement
  const num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) ? v : d; };
  function placeChanged() { refresh(); }
  ['pos-x', 'pos-y', 'pos-rot'].forEach((id) => $(id).addEventListener('change', () => {
    remember();
    S.place.x = num('pos-x', S.place.x);
    S.place.y = num('pos-y', S.place.y);
    S.place.rot = ((num('pos-rot', S.place.rot) % 360) + 360) % 360;
    viewer.setInstances(insts());
    placeChanged();
  }));
  ['cp-nx', 'cp-ny', 'cp-gap'].forEach((id) => $(id).addEventListener('change', () => {
    remember();
    S.copies.nx = clamp(Math.round(num('cp-nx', 1)), 1, 20);
    S.copies.ny = clamp(Math.round(num('cp-ny', 1)), 1, 20);
    S.copies.gap = Math.max(0, num('cp-gap', S.copies.gap));
    viewer.setInstances(insts());
    placeChanged();
    fitView();
  }));
  const rotBy = (d) => { remember(); S.place.rot = (((S.place.rot + d) % 360) + 360) % 360; viewer.setInstances(insts()); placeChanged(); };
  $('btn-rot-m').addEventListener('click', () => rotBy(-15));
  $('btn-rot-p').addEventListener('click', () => rotBy(15));
  $('btn-rot-90').addEventListener('click', () => rotBy(90));
  $('btn-to-fence').addEventListener('click', () => { remember(); S.place.x = 0; S.place.y = 0; viewer.setInstances(insts()); placeChanged(); });
  $('btn-center').addEventListener('click', () => {
    remember();
    const b = arrayBox();
    S.place.x = Math.round(((S.settings.bedX - b.w) / 2) * 2) / 2;
    S.place.y = Math.round(((S.settings.bedY - b.h) / 2) * 2) / 2;
    viewer.setInstances(insts());
    placeChanged();
    fitView();
  });

  // holes toolbar (the list itself is ui-holes.js)
  $('btn-optimize').addEventListener('click', () => {
    if (S.order.length < 3) { toast('Add at least three holes to reorder.'); return; }
    remember();
    const s = S.settings;
    const start = s.mode === 'xy' && s.park ? [s.parkX, s.parkY] : [0, 0];
    const inst = insts()[0];
    const pts = S.order.map((id) => { const h = byId(id); const w = IP.place.toWorld(inst, h.x, h.y); return { id, x: w.x, y: w.y }; });
    S.order = IP.gcode.optimizeOrder(pts, start[0], start[1]).map((p) => p.id);
    refresh();
    toast('Reordered for the shortest travel.');
  });
  $('btn-add').addEventListener('click', () => setTool(S.tool === 'place' ? 'select' : 'place'));

  // settings & profiles
  $('settings-form').addEventListener('change', onSetting);
  $('settings-form').addEventListener('click', (e) => {
    if (e.target.id !== 'btn-reset') return;
    remember();
    S.settings = Object.assign({}, IP.DEFAULT_SETTINGS);
    saveSettings(); renderSettings(); setBed();
    if (S.part) detect(true);
    toast('Restored default settings.');
  });
  $('profile-select').addEventListener('change', (e) => {
    const name = e.target.value;
    if (!name || !S.profiles[name]) return;
    remember();
    S.profile = name;
    store.set(PROF_KEY + '.current', name);
    S.settings = Object.assign({}, IP.DEFAULT_SETTINGS, S.profiles[name]);
    saveSettings(); renderSettings(); setBed();
    if (S.part) detect(true);
    toast(`Loaded the ${name} profile.`);
  });
  $('btn-profile-save').addEventListener('click', () => {
    const name = (window.prompt('Name this machine profile', S.profile || 'My press') || '').trim();
    if (!name) return;
    S.profiles[name] = Object.assign({}, S.settings);
    S.profile = name;
    store.set(PROF_KEY, S.profiles);
    store.set(PROF_KEY + '.current', name);
    renderProfiles();
    toast(`Saved the ${name} profile.`);
  });
  $('btn-profile-del').addEventListener('click', () => {
    if (!S.profile || !window.confirm(`Delete the ${S.profile} profile? Your current settings stay as they are.`)) return;
    delete S.profiles[S.profile];
    store.set(PROF_KEY, S.profiles);
    toast(`Deleted the ${S.profile} profile.`);
    S.profile = '';
    store.set(PROF_KEY + '.current', '');
    renderProfiles();
  });

  // view
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.view; fitView(); }));
  $('btn-fit').addEventListener('click', fitView);
  $('btn-xray').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    viewer.setXray(on);
  });
  $('btn-iron').addEventListener('click', (e) => {
    S.showIron = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(S.showIron));
    updateView();
  });
  $('btn-keys').addEventListener('click', () => $('keys').showModal());
  $('keys').addEventListener('click', (e) => { if (e.target.id === 'keys' || e.target.closest('[data-close]')) $('keys').close(); });
  $('btn-path').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    viewer.setPathVisible(on);
  });

  // timeline
  $('sim-play').addEventListener('click', () => (sim.playing ? simStop() : simPlay()));
  $('sim-range').addEventListener('input', (e) => {
    simStop();
    if (S.result) { simSet((+e.target.value / 1000) * S.result.seconds); markCodeLine(true); }
  });
  $('sim-speed').addEventListener('change', (e) => { sim.speed = +e.target.value; });

  // file drag and drop
  let dragDepth = 0;
  const isFileDrag = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!isFileDrag(e)) return; dragDepth++; $('drop-veil').hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!isFileDrag(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('drop-veil').hidden = true; } });
  window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    dragDepth = 0; $('drop-veil').hidden = true;
    readFile(e.dataTransfer.files[0]);
  });

  // keyboard
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') S.shift = false; });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') S.shift = true;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.target.closest && e.target.closest('input, select, textarea, dialog')) return;
    if (mod && e.key.toLowerCase() === 'a' && S.part && S.step === 'holes') { e.preventDefault(); ui.holes.selectShown(); return; }
    if (mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (e.key === '?') { $('keys').showModal(); return; }
    if (!S.part) return;
    if (k === 'r') setTool('measure');
    else if (k === 'i') $('btn-iron').click();
    else if (e.key === 'Escape' && (S.measure && S.measure.a)) clearMeasure();
    else if (e.key === 'Escape' && S.sel.size) ui.holes.clearSel();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.size) {
      remember(); S.order = S.order.filter((id) => !S.sel.has(id)); refresh();
    }
    else if (k === 'v') setTool('select');
    else if (k === 'm') setTool('move');
    else if (k === 'h') setTool('place');
    else if (k === 'f') fitView();
    else if (e.key === 'Escape') setTool('select');
    else if (e.key === ' ') { e.preventDefault(); if (sim.playing) simStop(); else simPlay(); }
    else if (e.key.startsWith('Arrow') && S.tool === 'move') {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      remember();
      if (e.key === 'ArrowLeft') S.place.x -= d;
      if (e.key === 'ArrowRight') S.place.x += d;
      if (e.key === 'ArrowUp') S.place.y += d;
      if (e.key === 'ArrowDown') S.place.y -= d;
      viewer.setInstances(insts());
      refresh();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && S.activeId != null && S.order.includes(S.activeId)) {
      toggleOrder(S.activeId);
    }
  });

  /* ---------- modules ---------- */
  const ctx = {
    S, byId, insts, worldHoles, refresh, updateView, remember, toast, toggleOrder, goStep, fmtTime,
    insertOptions, holeMeta, inspector,
    redraw() { ui.holes.render(); updateView(); },
    jobLabels: () => (S.part ? worldHoles().map((h) => h.label) : []),
    buildRun(o) {
      const all = worldHoles();
      const holes = o.only ? all.slice(o.from, o.from + 1) : all.slice(o.from);
      return IP.gcode.generate({ name: S.name, partTop: S.part.size.z, copies: insts().length, holes, settings: S.settings, air: o.air });
    },
    setLive(pos, hot) {
      const was = !!S.live;
      S.live = pos ? { pos, hot } : null;
      if (pos) viewer.setTip(pos, hot ? 'live-hot' : 'live');
      if (was !== !!pos) {
        const has = !!(S.result && S.result.moves.length);
        $('timeline').hidden = !has || !!pos;
        $('stage').classList.toggle('has-timeline', has && !pos);
        if (!pos) { if (has) simSet(sim.t); else viewer.setTip(null); }
      }
    },
    setRunMarks(m) { S.runMarks = m || {}; updateView(); },
    stageInset(px) {
      $('stage').classList.toggle('pendant-open', px > 0);
      $('stage').style.setProperty('--inset', px + 'px');
      if (viewer.setInsets) viewer.setInsets(px);
      if (is2D && S.part) fitView();
    },
  };
  ui.holes = IP.ui.holes.init(ctx);
  ui.machine = IP.ui.machine.init(ctx);
  IP.app = { S, viewer, ctx, ui }; // for the console and tests

  renderSettings();
  goStep('part');
})();
