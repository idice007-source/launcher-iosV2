/* Launcher iOS - script.js */
(function () {
'use strict';

/* ---------- Utilitaires ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function norm(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
const pad = n => (n < 10 ? '0' : '') + n;
let toastT = 0;
function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms || 2600); }

/* ---------- Plugin natif ---------- */
let L = null;
try {
  const C = window.Capacitor;
  if (C) { L = (C.Plugins && C.Plugins.Launcher) || (C.registerPlugin ? C.registerPlugin('Launcher') : null); }
} catch (e) { L = null; }
async function call(m, a) {
  if (!L || typeof L[m] !== 'function') return null;
  try { return await L[m](a || {}); } catch (e) { console.warn(m, e); return null; }
}
function listen(ev, fn) { try { if (L && L.addListener) L.addListener(ev, fn); } catch (e) { /* ignore */ } }
function hap(kind) { call('haptic', { kind: kind }); }

/* ---------- État ---------- */
const KEY = 'ios-launcher.v1';
const NKEY = 'ios-launcher.notes';
const defSet = { style: 'normal', hue: 210, widgets: 'duo', pct: true, lockStart: true, lockOff: true, depth: true, ckH: 230, ckW: 0.5, ckMode: 'stack', ckStyle: 'glass', ownBar: true, defAsked: false };
function loadState() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { home: j.home || [], dock: j.dock || [], hidden: j.hidden || [], set: Object.assign({}, defSet, j.set || {}) };
  } catch (e) { return { home: [], dock: [], hidden: [], set: Object.assign({}, defSet) }; }
}
let S = loadState();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

let APPS = [];
const APPMAP = {};
let EDIT = false, DRAG = null, G = null, curFolder = null, pickMode = false;

/* ---------- Applis ---------- */
function demoApps() {
  const n = ['โทรศัพท์', 'ข้อความ', 'เบราว์เซอร์', 'รูปภาพ', 'กล้องถ่ายรูป', 'อีเมล', 'แผนที่', 'พยากรณ์อากาศ', 'เพลง', 'โน้ต', 'นาฬิกา', 'ปฏิทิน', 'ตั้งค่า', 'เครื่องคิดเลข', 'เข็มทิศ', 'หุ้น', 'สุขภาพ', 'Wallet', 'พอดแคสต์', 'หนังสือ', 'ไฟล์', 'ทางลัด', 'เกม', 'วิดีโอ'];
  return n.map((x, i) => ({ pkg: 'demo.' + i, label: x, cat: (i % 9) - 1, icon: null, hue: (i * 37) % 360 }));
}
function iconSrc(a) {
  if (a && a.icon) return 'data:image/png;base64,' + a.icon;
  const h = a && a.hue != null ? a.hue : 210;
  const ch = a ? esc(a.label.charAt(0)) : '?';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(' + h + ',80%,62%)"/><stop offset="1" stop-color="hsl(' + ((h + 40) % 360) + ',80%,42%)"/></linearGradient></defs><rect width="96" height="96" fill="url(#g)"/><text x="48" y="64" font-size="46" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">' + ch + '</text></svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
async function loadApps() {
  let list = null;
  const r = await call('getApps');
  if (r && r.apps && r.apps.length) list = r.apps;
  if (!list) list = demoApps();
  APPS = list;
  Object.keys(APPMAP).forEach(k => delete APPMAP[k]);
  APPS.forEach(a => { APPMAP[a.pkg] = a; });
  normalize();
  renderHome();
}
function itemId(it) { return it.t === 'a' ? 'a:' + it.p : 'f:' + it.id; }
function allPlaced() {
  const s = new Set();
  S.dock.forEach(p => s.add(p));
  S.hidden.forEach(p => s.add(p));
  S.home.forEach(it => { if (it.t === 'a') s.add(it.p); else it.a.forEach(p => s.add(p)); });
  return s;
}
function tidy() {
  const out = [];
  S.home.forEach(it => {
    if (it.t === 'f') {
      if (it.a.length === 0) return;
      if (it.a.length === 1) { out.push({ t: 'a', p: it.a[0] }); return; }
    }
    out.push(it);
  });
  S.home = out;
}
function normalize() {
  const known = new Set(APPS.map(a => a.pkg));
  S.dock = S.dock.filter(p => known.has(p));
  S.hidden = S.hidden.filter(p => known.has(p));
  S.home = S.home.filter(it => {
    if (it.t === 'a') return known.has(it.p);
    it.a = it.a.filter(p => known.has(p));
    return it.a.length > 0;
  });
  tidy();
  let placed = allPlaced();
  if (!S.home.length && !S.dock.length) {
    [/dialer|phone|contacts/, /messag|mms|sms/, /chrome|browser|firefox|brave|opera/, /camera/].forEach(re => {
      const a = APPS.find(x => re.test(x.pkg) && !S.dock.includes(x.pkg));
      if (a) S.dock.push(a.pkg);
    });
    placed = allPlaced();
  }
  APPS.forEach(a => { if (!placed.has(a.pkg)) { S.home.push({ t: 'a', p: a.pkg }); placed.add(a.pkg); } });
  save();
}
function removeAll(pkg) {
  S.dock = S.dock.filter(p => p !== pkg);
  S.hidden = S.hidden.filter(p => p !== pkg);
  S.home = S.home.filter(it => (it.t === 'a' ? it.p !== pkg : true));
  S.home.forEach(it => { if (it.t === 'f') it.a = it.a.filter(p => p !== pkg); });
}
function commit() { save(); renderHome(); }
function toHome(p) { removeAll(p); S.home.push({ t: 'a', p: p }); tidy(); commit(); }
function toDock(p) { if (S.dock.length >= 4) { toast('Dock เต็มแล้ว'); return; } removeAll(p); S.dock.push(p); tidy(); commit(); }
function hideApp(p) { removeAll(p); S.hidden.push(p); tidy(); commit(); }
function dissolve(fid) {
  const i = S.home.findIndex(x => x.t === 'f' && x.id === fid);
  if (i < 0) return;
  const f = S.home[i];
  S.home.splice.apply(S.home, [i, 1].concat(f.a.map(p => ({ t: 'a', p: p }))));
  closeFolder(true);
  commit();
}

/* ---------- Rendu de l'accueil ---------- */
const COLS = 4;
function geometry() {
  const h = $('#pages').clientHeight || 600;
  const rows = Math.max(3, Math.floor(h / 96));
  return { rows: rows, rowH: h / rows };
}
function wRows() { return S.set.widgets === 'none' ? 0 : 2; }
function chunk(items, g) {
  const pages = []; let i = 0, p = 0;
  while (i < items.length || p === 0) {
    const cap = COLS * (g.rows - (p === 0 ? wRows() : 0));
    pages.push(items.slice(i, i + cap));
    i += cap; p++;
    if (cap <= 0 || p > 60) break;
  }
  return pages;
}
function itemEl(it, src) {
  const d = el('div', 'item');
  d.dataset.src = src;
  if (it.t === 'a') {
    const a = APPMAP[it.p];
    if (!a) return d;
    d.dataset.id = 'a:' + it.p; d.dataset.pkg = it.p;
    d.innerHTML = '<div class="ic"><img draggable="false" src="' + iconSrc(a) + '"></div>' +
      (src === 'dock' ? '' : '<span>' + esc(a.label) + '</span>') +
      (src === 'home' ? '<i class="minus">\u2212</i>' : '');
  } else {
    d.dataset.id = 'f:' + it.id; d.dataset.fid = it.id;
    const minis = it.a.filter(p => APPMAP[p]).slice(0, 9).map(p => '<img src="' + iconSrc(APPMAP[p]) + '">').join('');
    d.innerHTML = '<div class="ic fold">' + minis + '</div><span>' + esc(it.n) + '</span>';
  }
  if (DRAG && DRAG.id === d.dataset.id) d.classList.add('ghost');
  return d;
}
function renderHome() {
  const g = geometry();
  const pages = $('#pages');
  const keep = pages.scrollLeft;
  pages.innerHTML = '';
  const ch = chunk(S.home, g);
  ch.forEach((arr, pi) => {
    const pg = el('div', 'page');
    pg.style.setProperty('--rowH', g.rowH + 'px');
    if (pi === 0 && wRows()) pg.appendChild(buildWidgets());
    const grid = el('div', 'grid');
    arr.forEach(it => grid.appendChild(itemEl(it, 'home')));
    pg.appendChild(grid);
    pages.appendChild(pg);
  });
  pages.appendChild(buildLibrary());
  const dk = $('#dock');
  dk.innerHTML = '';
  S.dock.forEach(p => { if (APPMAP[p]) dk.appendChild(itemEl({ t: 'a', p: p }, 'dock')); });
  dk.style.visibility = S.dock.length ? 'visible' : 'hidden';
  const dots = $('#dots');
  dots.innerHTML = '';
  for (let i = 0; i < ch.length + 1; i++) dots.appendChild(el('i'));
  pages.scrollLeft = keep;
  updDots();
  applyStyle();
}
function updDots() {
  const i = Math.round($('#pages').scrollLeft / Math.max(1, innerWidth));
  $$('#dots i').forEach((d, j) => d.classList.toggle('on', j === i));
}

/* ---------- Widgets ---------- */
function buildWidgets() {
  const w = el('div', 'widgets');
  if (S.set.widgets === 'notes') {
    const n = el('div', 'wg gl notes', '<b>โน้ต</b><textarea placeholder="เขียนที่นี่…"></textarea>');
    const ta = $('textarea', n);
    ta.value = localStorage.getItem(NKEY) || '';
    ta.addEventListener('input', () => localStorage.setItem(NKEY, ta.value));
    w.appendChild(n);
  } else {
    w.appendChild(el('div', 'wg gl date', '<small class="wgDow"></small><big class="wgDay"></big><span class="wgSub"></span>'));
    w.appendChild(el('div', 'wg gl wbat', '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="7"/><circle class="ring" cx="32" cy="32" r="28" fill="none" stroke="#34c759" stroke-width="7" stroke-linecap="round" stroke-dasharray="176" transform="rotate(-90 32 32)"/><text class="wgPct" x="32" y="37" text-anchor="middle" fill="#fff" font-size="15" font-weight="700"></text></svg><span class="wgBS"></span>'));
  }
  setTimeout(updWidgets, 0);
  return w;
}
function updWidgets() {
  const d = new Date();
  $$('.wgDow').forEach(e => { e.textContent = d.toLocaleDateString('th-TH', { weekday: 'long' }); });
  $$('.wgDay').forEach(e => { e.textContent = d.getDate(); });
  $$('.wgSub').forEach(e => { e.textContent = d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }); });
  const p = Math.round(B.level);
  const col = B.charging ? '#34c759' : (B.saver ? '#ffd60a' : (p <= 20 ? '#ff3b30' : '#34c759'));
  $$('.ring').forEach(e => { e.style.strokeDashoffset = 176 * (1 - p / 100); e.style.stroke = col; });
  $$('.wgPct').forEach(e => { e.textContent = p + '%'; });
  $$('.wgBS').forEach(e => { e.textContent = B.charging ? 'กำลังชาร์จ' : (B.saver ? 'โหมดประหยัดพลังงาน' : 'แบตเตอรี่'); });
}

/* ---------- Bibliothèque d'apps ---------- */
const CATS = { 0: 'เกม', 1: 'เพลง', 2: 'วิดีโอ', 3: 'ภาพถ่าย', 4: 'โซเชียล', 5: 'ข่าว', 6: 'แผนที่', 7: 'ผลิตภาพ' };
function buildLibrary() {
  const pg = el('div', 'page lib');
  pg.innerHTML = '<div class="gl libSearch"><span>🔍</span><input class="libIn" placeholder="คลังแอป" autocomplete="off"></div><div class="libBody"></div>';
  const body = $('.libBody', pg);
  const draw = q => {
    body.innerHTML = '';
    const n = norm(q.trim());
    if (n) {
      const grid = el('div', 'grid');
      APPS.filter(a => norm(a.label).includes(n)).forEach(a => grid.appendChild(itemEl({ t: 'a', p: a.pkg }, 'lib')));
      body.appendChild(grid);
      return;
    }
    const groups = {};
    APPS.forEach(a => { const k = CATS[a.cat] || 'อื่น ๆ'; (groups[k] = groups[k] || []).push(a); });
    Object.keys(groups).sort((x, y) => (x === 'อื่น ๆ') - (y === 'อื่น ๆ') || x.localeCompare(y, 'th')).forEach(k => {
      const card = el('div', 'cat gl', '<h4>' + esc(k) + '</h4>');
      const grid = el('div', 'grid');
      groups[k].forEach(a => grid.appendChild(itemEl({ t: 'a', p: a.pkg }, 'lib')));
      card.appendChild(grid);
      body.appendChild(card);
    });
  };
  draw('');
  $('.libIn', pg).addEventListener('input', e => draw(e.target.value));
  return pg;
}

/* ---------- Style des icônes ---------- */
function applyStyle() {
  const a = $('#app');
  ['st-normal', 'st-dark', 'st-tint', 'st-clear'].forEach(c => a.classList.remove(c));
  a.classList.add('st-' + S.set.style);
  a.style.setProperty('--hue', S.set.hue);
}

/* ---------- Ouverture d'une appli ---------- */
function zoom(node, a) {
  const ic = node && node.querySelector('.ic');
  if (!ic) return;
  const r = ic.getBoundingClientRect();
  const z = el('div', 'zoom');
  z.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;background-image:url("' + iconSrc(a) + '")';
  document.body.appendChild(z);
  requestAnimationFrame(() => requestAnimationFrame(() => z.classList.add('go')));
  setTimeout(() => z.remove(), 800);
}
function openApp(pkg, node) {
  const a = APPMAP[pkg];
  if (!a) return;
  hap('light');
  zoom(node, a);
  if (curFolder) setTimeout(() => closeFolder(), 300);
  setTimeout(() => { call('launch', { pkg: pkg }).then(r => { if (!L) toast('ตัวอย่าง : ' + a.label); }); }, 150);
}

/* ---------- Dossiers ---------- */
function openFolder(fid) {
  const f = S.home.find(x => x.t === 'f' && x.id === fid);
  if (!f) return;
  curFolder = fid;
  const nm = $('#folderName');
  nm.value = f.n;
  nm.onchange = () => { f.n = nm.value.trim() || 'โฟลเดอร์'; save(); };
  const g = $('#folderGrid');
  g.innerHTML = '';
  f.a.forEach(p => { if (APPMAP[p]) g.appendChild(itemEl({ t: 'a', p: p }, 'fold')); });
  $('#folder').classList.add('on');
}
function closeFolder(silent) {
  if (!curFolder) return;
  $('#folder').classList.remove('on');
  curFolder = null;
  if (!silent) { save(); renderHome(); }
}
$('#folder').addEventListener('click', e => { if (e.target.id === 'folder') closeFolder(); });

/* ---------- Menu contextuel ---------- */
function closeMenu() { $('#menuBack').classList.remove('on'); }
function showMenu(it, x, y) {
  const src = it.dataset.src, pkg = it.dataset.pkg, fid = it.dataset.fid;
  const o = [];
  if (pkg) {
    o.push(['ข้อมูลแอป', () => call('appInfo', { pkg: pkg })]);
    if (src === 'dock') {
      o.push(['นำออกจาก Dock', () => toHome(pkg)]);
    } else if (S.hidden.includes(pkg)) {
      o.push(['เพิ่มไปที่หน้าจอหลัก', () => toHome(pkg)]);
    } else {
      o.push(['เพิ่มไปที่ Dock', () => toDock(pkg)]);
      if (src === 'fold') o.push(['นำออกจากโฟลเดอร์', () => toHome(pkg)]);
      if (src === 'home' || src === 'fold') o.push(['นำออกจากหน้าจอหลัก', () => hideApp(pkg)]);
    }
    o.push(['ถอนการติดตั้ง', () => call('uninstall', { pkg: pkg }), true]);
  } else if (fid) {
    o.push(['เปิด', () => openFolder(fid)]);
    o.push(['ยกเลิกโฟลเดอร์', () => dissolve(fid)]);
  }
  if (src === 'home' || src === 'dock') o.push(['แก้ไขหน้าจอหลัก', () => setEdit(true)]);
  const m = $('#menu');
  m.innerHTML = '';
  o.forEach(op => {
    const b = el('button', op[2] ? 'danger' : '', esc(op[0]));
    b.addEventListener('click', () => { closeMenu(); op[1](); });
    m.appendChild(b);
  });
  $('#menuBack').classList.add('on');
  const W = innerWidth, H = innerHeight;
  const mh = m.offsetHeight, mw = m.offsetWidth;
  m.style.left = Math.max(10, Math.min(W - mw - 10, x - mw / 2)) + 'px';
  m.style.top = Math.max(10, (y + 24 + mh > H - 10) ? y - mh - 24 : y + 24) + 'px';
}
$('#menuBack').addEventListener('pointerdown', e => { if (e.target.id === 'menuBack') closeMenu(); });

/* ---------- Mode édition et glisser-déposer ---------- */
function setEdit(on) {
  EDIT = on;
  $('#home').classList.toggle('editing', on);
  closeMenu();
  if (on) hap('heavy'); else save();
}
$('#eDone').addEventListener('click', () => setEdit(false));
$('#eSet').addEventListener('click', () => openSheet());
document.addEventListener('click', e => {
  const m = e.target.closest('.minus');
  if (!m) return;
  const it = m.closest('.item');
  if (it && it.dataset.pkg) { hap('light'); hideApp(it.dataset.pkg); }
});

function tap(it) {
  const src = it.dataset.src;
  if (it.dataset.pkg) {
    if (EDIT && src !== 'fold') return;
    openApp(it.dataset.pkg, it);
  } else if (it.dataset.fid) {
    openFolder(it.dataset.fid);
  }
}
function lockVisible() { return !$('#lock').classList.contains('gone'); }
function overlayOpen() { return ['#spot', '#folder', '#menuBack', '#sheet'].some(s => $(s).classList.contains('on')); }

document.addEventListener('pointerdown', e => {
  if (lockVisible()) return;
  if (e.target.closest('.minus')) return;
  const it = e.target.closest('.item');
  if (it && it.dataset.id) {
    G = { it: it, x: e.clientX, y: e.clientY, moved: false, fired: false, edit: EDIT };
    G.timer = setTimeout(() => {
      if (!G || G.moved || EDIT) return;
      G.fired = true;
      hap('heavy');
      showMenu(G.it, G.x, G.y);
    }, 420);
    return;
  }
  if (!EDIT && !overlayOpen() && e.target.closest('#pages') && !e.target.closest('.lib') && !e.target.closest('.wg')) {
    G = { it: null, x: e.clientX, y: e.clientY, moved: false, fired: false, edit: false };
    G.timer = setTimeout(() => { if (G && !G.moved) { G.fired = true; setEdit(true); } }, 480);
  }
});
document.addEventListener('pointermove', e => {
  if (DRAG) { dragMove(e); return; }
  if (!G) return;
  if (Math.hypot(e.clientX - G.x, e.clientY - G.y) > 8) {
    if (G.edit && G.it && (G.it.dataset.src === 'home' || G.it.dataset.src === 'dock')) {
      startDrag(G.it, e);
      clearTimeout(G.timer);
      G = null;
    } else {
      clearTimeout(G.timer);
      G.moved = true;
    }
  }
});
document.addEventListener('pointerup', e => {
  if (DRAG) { endDrag(e); return; }
  if (!G) return;
  clearTimeout(G.timer);
  const g = G; G = null;
  if (g.fired || g.moved || !g.it) return;
  tap(g.it);
});
document.addEventListener('pointercancel', e => {
  if (DRAG) { endDrag(e); return; }
  if (G) { clearTimeout(G.timer); G = null; }
});

function startDrag(it, e) {
  const r = it.getBoundingClientRect();
  const clone = it.cloneNode(true);
  clone.classList.add('dragclone');
  clone.style.left = r.left + 'px'; clone.style.top = r.top + 'px';
  clone.style.width = r.width + 'px'; clone.style.height = r.height + 'px';
  document.body.appendChild(clone);
  DRAG = { id: it.dataset.id, src: it.dataset.src, clone: clone, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, target: null, mt: 0, edgeT: 0, cool: 0 };
  try { $('#app').setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  it.classList.add('ghost');
  hap('light');
  dragMove(e);
}
function dragMove(e) {
  const D = DRAG;
  D.clone.style.transform = 'translate(' + (e.clientX - D.sx) + 'px,' + (e.clientY - D.sy) + 'px) scale(1.12)';
  D.x = e.clientX; D.y = e.clientY;
  const W = innerWidth;
  if (D.src === 'home') {
    if (e.clientX < 34 || e.clientX > W - 34) {
      if (!D.edgeT) D.edgeT = setTimeout(() => { $('#pages').scrollBy({ left: (D.x < 34 ? -1 : 1) * W, behavior: 'smooth' }); D.edgeT = 0; }, 550);
    } else { clearTimeout(D.edgeT); D.edgeT = 0; }
  }
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const ti = t && t.closest ? t.closest('.item') : null;
  if (!ti || !ti.dataset.id || ti.dataset.id === D.id || ti.dataset.src !== D.src) {
    D.target = null; clearTimeout(D.mt); D.mt = 0;
    return;
  }
  const r = ti.getBoundingClientRect();
  const rx = (e.clientX - r.left) / r.width;
  const tid = ti.dataset.id;
  if (D.src === 'home' && rx > 0.28 && rx < 0.72) {
    if (D.target !== tid) {
      D.target = tid; clearTimeout(D.mt);
      D.mt = setTimeout(() => mergeInto(D.id, tid), 480);
    }
  } else {
    if (D.target !== null) { D.target = null; clearTimeout(D.mt); D.mt = 0; }
    if (Date.now() > D.cool) { reorder(D.id, tid, rx < 0.5, D.src); D.cool = Date.now() + 260; }
  }
}
function reorder(did, tid, before, src) {
  if (src === 'home') {
    const Lh = S.home;
    const i = Lh.findIndex(x => itemId(x) === did);
    if (i < 0) return;
    const m = Lh.splice(i, 1)[0];
    const j = Lh.findIndex(x => itemId(x) === tid);
    if (j < 0) { Lh.splice(i, 0, m); return; }
    Lh.splice(before ? j : j + 1, 0, m);
  } else {
    const Ld = S.dock;
    const dp = did.slice(2), tp = tid.slice(2);
    const i = Ld.indexOf(dp);
    if (i < 0) return;
    Ld.splice(i, 1);
    const j = Ld.indexOf(tp);
    if (j < 0) { Ld.splice(i, 0, dp); return; }
    Ld.splice(before ? j : j + 1, 0, dp);
  }
  renderHome();
}
function finishDrag() {
  const D = DRAG;
  if (!D) return;
  clearTimeout(D.mt); clearTimeout(D.edgeT);
  D.clone.remove();
  DRAG = null;
  save();
  renderHome();
}
function mergeInto(did, tid) {
  const D = DRAG;
  if (!D) return;
  const Lh = S.home;
  const di = Lh.findIndex(x => itemId(x) === did);
  const ti = Lh.findIndex(x => itemId(x) === tid);
  if (di < 0 || ti < 0) return;
  const d = Lh[di], t = Lh[ti];
  if (d.t !== 'a') return;
  if (t.t === 'f') {
    t.a.push(d.p);
    Lh.splice(di, 1);
  } else {
    Lh[ti] = { t: 'f', id: 'f' + Date.now().toString(36), n: 'โฟลเดอร์', a: [t.p, d.p] };
    Lh.splice(di, 1);
  }
  hap('heavy');
  finishDrag();
}
function endDrag(e) {
  const D = DRAG;
  if (!D) return;
  if (e && e.type === 'pointerup' && D.src === 'home') {
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const ti = t && t.closest ? t.closest('.item') : null;
    if (!ti && t && t.closest && t.closest('#pages')) {
      const pi = Math.round($('#pages').scrollLeft / Math.max(1, innerWidth));
      const ch = chunk(S.home, geometry());
      if (pi < ch.length) {
        const arr = ch[pi];
        const last = arr[arr.length - 1];
        if (last && itemId(last) !== D.id) {
          const Lh = S.home;
          const i = Lh.findIndex(x => itemId(x) === D.id);
          if (i >= 0) {
            const m = Lh.splice(i, 1)[0];
            const j = Lh.findIndex(x => itemId(x) === itemId(last));
            Lh.splice(j + 1, 0, m);
          }
        }
      }
    }
  }
  finishDrag();
}

/* ---------- Spotlight ---------- */
function openSpot() {
  $('#spot').classList.add('on');
  const i = $('#spotIn');
  i.value = '';
  spotDraw('');
  setTimeout(() => i.focus(), 60);
  hap('light');
}
function closeSpot() { $('#spot').classList.remove('on'); $('#spotIn').blur(); }
function spotDraw(q) {
  const box = $('#spotRes');
  box.innerHTML = '';
  const n = norm(q.trim());
  let list;
  if (n) {
    list = APPS.filter(a => norm(a.label).includes(n)).sort((a, b) => (norm(a.label).startsWith(n) ? 0 : 1) - (norm(b.label).startsWith(n) ? 0 : 1)).slice(0, 12);
  } else {
    list = APPS.slice(0, 5);
    box.appendChild(el('div', 'srow hd', 'แนะนำ'));
  }
  list.forEach(a => {
    const r = el('div', 'srow', '<div class="ic"><img src="' + iconSrc(a) + '"></div><span>' + esc(a.label) + '</span>');
    r.addEventListener('click', () => { closeSpot(); openApp(a.pkg, null); });
    box.appendChild(r);
  });
  if (n) {
    const w = el('div', 'srow', '<div class="ic web">🌐</div><span>ค้นหา « ' + esc(q.trim()) + ' » บนเว็บ</span>');
    w.addEventListener('click', () => { closeSpot(); call('openUrl', { url: 'https://www.google.com/search?q=' + encodeURIComponent(q.trim()) }); });
    box.appendChild(w);
  }
}
$('#spotIn').addEventListener('input', e => spotDraw(e.target.value));
$('#spotX').addEventListener('click', closeSpot);
$('#spot').addEventListener('pointerdown', e => { if (e.target.id === 'spot') closeSpot(); });

let T = null;
function canGesture(e) {
  return !EDIT && !lockVisible() && !overlayOpen() && e.target.closest && e.target.closest('#pages') && !e.target.closest('.lib') && !e.target.closest('textarea');
}
document.addEventListener('touchstart', e => {
  if (!canGesture(e)) { T = null; return; }
  const t = e.touches[0];
  T = { x: t.clientX, y: t.clientY, done: false };
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!T || T.done) return;
  const t = e.touches[0];
  if (t.clientY - T.y > 80 && Math.abs(t.clientX - T.x) < 50) { T.done = true; if (G) { clearTimeout(G.timer); G = null; } openSpot(); }
}, { passive: true });
$('#pages').addEventListener('scroll', updDots, { passive: true });

/* ---------- Réglages ---------- */
function syncSheet() {
  $$('#sgStyle button').forEach(b => b.classList.toggle('on', b.dataset.v === S.set.style));
  $$('#sgWid button').forEach(b => b.classList.toggle('on', b.dataset.v === S.set.widgets));
  $('#rHue').value = S.set.hue;
  $('#hueRow').style.display = S.set.style === 'tint' ? 'block' : 'none';
  [['tgPct', 'pct'], ['tgLockStart', 'lockStart'], ['tgLockOff', 'lockOff'], ['tgOwnBar', 'ownBar']].forEach(p => $('#' + p[0]).classList.toggle('on', !!S.set[p[1]]));
}
function openSheet() { syncSheet(); $('#sheet').classList.add('on'); }
function closeSheet() { $('#sheet').classList.remove('on'); save(); }
$('#shX').addEventListener('click', closeSheet);
$('#sheet').addEventListener('pointerdown', e => { if (e.target.id === 'sheet') closeSheet(); });
$$('#sgStyle button').forEach(b => b.addEventListener('click', () => { S.set.style = b.dataset.v; applyStyle(); syncSheet(); save(); }));
$$('#sgWid button').forEach(b => b.addEventListener('click', () => { S.set.widgets = b.dataset.v; syncSheet(); commit(); }));
$('#rHue').addEventListener('input', e => { S.set.hue = +e.target.value; applyStyle(); save(); });
[['tgPct', 'pct'], ['tgLockStart', 'lockStart'], ['tgLockOff', 'lockOff'], ['tgOwnBar', 'ownBar']].forEach(p => $('#' + p[0]).addEventListener('click', () => { S.set[p[1]] = !S.set[p[1]]; syncSheet(); updBat(); applyBar(); save(); }));
$('#shWall').addEventListener('click', () => $('#fWall').click());
$('#shHome').addEventListener('click', () => call('requestHome'));

/* ---------- Fond d'écran et détourage ---------- */
const idb = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      if (this.db) return res(this.db);
      const r = indexedDB.open('ios-launcher', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) {
    try {
      const db = await this.open();
      return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
    } catch (e) { return null; }
  },
  async set(k, v) {
    try {
      const db = await this.open();
      return await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); });
    } catch (e) { return false; }
  },
  async del(k) {
    try {
      const db = await this.open();
      return await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(true); t.onerror = () => res(false); });
    } catch (e) { return false; }
  }
};
let wallURL = null, cutURL = null;
async function loadWall() {
  const w = await idb.get('wall'), c = await idb.get('cut');
  if (wallURL) URL.revokeObjectURL(wallURL);
  if (cutURL) URL.revokeObjectURL(cutURL);
  wallURL = w ? URL.createObjectURL(w) : null;
  cutURL = c ? URL.createObjectURL(c) : null;
  applyWall();
}
function applyWall() {
  const has = !!wallURL;
  ['#wall', '#lkBg'].forEach(s => {
    const e = $(s);
    e.classList.toggle('defwall', !has);
    e.style.backgroundImage = has ? 'url("' + wallURL + '")' : '';
  });
  const sj = $('#lkSubj');
  const show = !!cutURL && S.set.depth;
  sj.style.display = show ? 'block' : 'none';
  sj.style.backgroundImage = cutURL ? 'url("' + cutURL + '")' : '';
}
function fileToImage(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => res({ im: im, u: u });
    im.onerror = rej;
    im.src = u;
  });
}
async function setWallpaper(file) {
  const o = await fileToImage(file);
  const im = o.im;
  const k = Math.min(1, 1280 / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  URL.revokeObjectURL(o.u);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
  await idb.set('wall', blob);
  await idb.del('cut');
  await loadWall();
}
async function getWallCanvas() {
  const w = await idb.get('wall');
  if (!w) return null;
  const o = await fileToImage(w);
  const c = document.createElement('canvas');
  c.width = o.im.naturalWidth; c.height = o.im.naturalHeight;
  c.getContext('2d').drawImage(o.im, 0, 0);
  URL.revokeObjectURL(o.u);
  return c;
}
const SEGS = {};
const MODELS = {
  inter: { cls: 'InteractiveSegmenter', file: 'magic_touch.tflite', cdn: 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite' },
  selfie: { cls: 'ImageSegmenter', file: 'selfie_segmenter.tflite', cdn: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite' }
};
async function getSegmenter(kind) {
  if (SEGS[kind]) return SEGS[kind];
  const M = MODELS[kind];
  const base = new URL('vendor/', location.href).href;
  const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/';
  const sources = [
    { lib: base + 'vision_bundle.js', wasm: base + 'wasm', model: base + M.file },
    { lib: CDN + 'vision_bundle.mjs', wasm: CDN + 'wasm', model: M.cdn }
  ];
  let lastErr = null;
  for (const s of sources) {
    try {
      const mod = await import(s.lib);
      const fs = await mod.FilesetResolver.forVisionTasks(s.wasm);
      SEGS[kind] = await mod[M.cls].createFromOptions(fs, {
        baseOptions: { modelAssetPath: s.model },
        outputCategoryMask: true,
        outputConfidenceMasks: false
      });
      return SEGS[kind];
    } catch (e) { lastErr = e; console.warn('แหล่ง IA ล้มเหลว', s.lib, e); }
  }
  throw lastErr || new Error('IA ไม่พร้อมใช้งาน');
}
async function runInteractive(c, nx, ny) {
  const seg = await getSegmenter('inter');
  let out = null;
  seg.segment(c, { keypoint: { x: nx, y: ny } }, r => {
    const m = r.categoryMask;
    out = { arr: m.getAsUint8Array().slice(), w: m.width, h: m.height };
  });
  return out;
}
async function runSelfie(c) {
  const seg = await getSegmenter('selfie');
  let out = null;
  seg.segment(c, r => {
    const m = r.categoryMask;
    out = { arr: m.getAsUint8Array().slice(), w: m.width, h: m.height };
  });
  return out;
}
/* Garde uniquement la zone connectée au point touché (le pixel touché fait foi pour savoir quelle valeur = sujet) */
function buildCut(m, nx, ny) {
  const w = m.w, h = m.h, n = w * h;
  const px = Math.min(w - 1, Math.floor(nx * w)), py = Math.min(h - 1, Math.floor(ny * h));
  const fg = m.arr[py * w + px];
  const keep = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0, count = 1;
  const start = py * w + px;
  keep[start] = 1; stack[sp++] = start;
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    if (x > 0) { const j = i - 1; if (!keep[j] && m.arr[j] === fg) { keep[j] = 1; stack[sp++] = j; count++; } }
    if (x < w - 1) { const j = i + 1; if (!keep[j] && m.arr[j] === fg) { keep[j] = 1; stack[sp++] = j; count++; } }
    if (i >= w) { const j = i - w; if (!keep[j] && m.arr[j] === fg) { keep[j] = 1; stack[sp++] = j; count++; } }
    if (i < n - w) { const j = i + w; if (!keep[j] && m.arr[j] === fg) { keep[j] = 1; stack[sp++] = j; count++; } }
  }
  return { keep: keep, count: count, ratio: count / n, w: w, h: h };
}
function shortErr(e) { return String(e && e.message ? e.message : e).slice(0, 90); }
async function cutSubject(tx, ty) {
  toast('กำลังตัดภาพ…', 20000);
  try {
    const c = await getWallCanvas();
    if (!c) { toast('เลือกวอลเปเปอร์ก่อน'); return; }
    const sw = innerWidth, sh = innerHeight;
    const k = Math.max(sw / c.width, sh / c.height);
    const dw = c.width * k, dh = c.height * k;
    const nx = Math.min(1, Math.max(0, (tx - (sw - dw) / 2) / dw));
    const ny = Math.min(1, Math.max(0, (ty - (sh - dh) / 2) / dh));
    const log = [];
    let res = null;
    const okRatio = r => r >= 0.012 && r <= 0.88;
    try {
      const m = await runInteractive(c, nx, ny);
      if (!m) throw new Error('ไม่มีมาสก์');
      const b = buildCut(m, nx, ny);
      log.push('IA 1 : ' + Math.round(b.ratio * 100) + ' %');
      if (okRatio(b.ratio)) res = b;
    } catch (e) { log.push('IA 1 : ' + shortErr(e)); }
    if (!res) {
      try {
        const m = await runSelfie(c);
        if (!m) throw new Error('ไม่มีมาสก์');
        const b = buildCut(m, nx, ny);
        log.push('IA 2 : ' + Math.round(b.ratio * 100) + ' %');
        if (okRatio(b.ratio)) res = b;
      } catch (e) { log.push('IA 2 : ' + shortErr(e)); }
    }
    if (!res) { toast('ตัดวัตถุไม่สำเร็จ แตะให้ตรงกลางวัตถุ (' + log.join(' ; ') + ')', 10000); return; }
    const mc = document.createElement('canvas');
    mc.width = res.w; mc.height = res.h;
    const mx = mc.getContext('2d');
    const id = mx.createImageData(res.w, res.h);
    for (let i = 0; i < res.keep.length; i++) id.data[i * 4 + 3] = res.keep[i] ? 255 : 0;
    mx.putImageData(id, 0, 0);
    const oc = document.createElement('canvas');
    oc.width = c.width; oc.height = c.height;
    const ox = oc.getContext('2d');
    ox.drawImage(c, 0, 0);
    ox.globalCompositeOperation = 'destination-in';
    ox.filter = 'blur(1.2px)';
    ox.drawImage(mc, 0, 0, oc.width, oc.height);
    const blob = await new Promise(r => oc.toBlob(r, 'image/png'));
    await idb.set('cut', blob);
    await loadWall();
    toast('ตัดวัตถุสำเร็จ ✔ (' + Math.round(res.ratio * 100) + ' % ของภาพ)', 4000);
  } catch (e) {
    console.warn(e);
    toast('ตัดภาพไม่ได้ : ' + shortErr(e), 10000);
  }
}
$('#fWall').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { await setWallpaper(f); toast('เปลี่ยนวอลเปเปอร์แล้ว แตะ "ตัดภาพ" เพื่อเอฟเฟกต์ความลึก'); } catch (err) { toast('อ่านรูปไม่ได้'); }
});
$('#fCut').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  await idb.set('cut', f);
  await loadWall();
  toast('นำเข้าการตัดภาพแล้ว ✔');
});

/* ---------- Écran verrouillé ---------- */
const lock = $('#lock');
function showLock() {
  closeAll();
  lock.classList.remove('gone', 'edit', 'pick');
  lock.style.transition = 'none';
  lock.style.transform = ''; lock.style.opacity = '';
  void lock.offsetWidth;
  lock.style.transition = '';
  $('#app').classList.add('locked');
  renderClock();
}
function unlock() {
  hap('light');
  $('#app').classList.remove('locked');
  lock.style.transform = 'translateY(-105%)';
  lock.style.opacity = '0';
  setTimeout(() => { lock.classList.add('gone'); lock.style.transform = ''; lock.style.opacity = ''; }, 380);
}
function closeAll() {
  closeMenu(); closeSpot(); closeSheet();
  if (curFolder) closeFolder();
  if (EDIT) setEdit(false);
}
function renderClock() {
  const d = new Date();
  const h = pad(d.getHours()), m = pad(d.getMinutes());
  if (S.set.ckMode === 'line') { $('#ck1').textContent = h + ':' + m; $('#ck2').textContent = ''; }
  else { $('#ck1').textContent = h; $('#ck2').textContent = m; }
  $('#lkDate').textContent = d.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' });
  fitClock();
}
function fitClock() {
  if (lock.classList.contains('gone')) return;
  const ck = $('#ckIn');
  lock.classList.toggle('line', S.set.ckMode === 'line');
  ck.dataset.s = S.set.ckStyle;
  ck.style.fontSize = S.set.ckH + 'px';
  ck.style.transform = 'translateX(-50%)';
  const nat = ck.getBoundingClientRect().width || 1;
  const want = innerWidth * (S.set.ckMode === 'line' ? Math.min(0.95, S.set.ckW * 1.7) : S.set.ckW);
  const s = Math.max(0.2, Math.min(3, want / nat));
  ck.style.transform = 'translateX(-50%) scaleX(' + s.toFixed(4) + ')';
  const r = ck.getBoundingClientRect();
  const f = $('#ckFrame');
  f.style.left = (r.left - 8) + 'px'; f.style.top = (r.top - 6) + 'px';
  f.style.width = (r.width + 16) + 'px'; f.style.height = (r.height + 12) + 'px';
}
function syncPanel() {
  $$('#ckStyles button').forEach(b => b.classList.toggle('on', b.dataset.v === S.set.ckStyle));
  $('#rW').value = Math.round(S.set.ckW * 100);
  $('#rH').value = S.set.ckH;
  $('#bDepth').classList.toggle('on', !!S.set.depth);
  $('#bMode').textContent = S.set.ckMode === 'line' ? 'สไตล์ : บรรทัด' : 'สไตล์ : เรียงซ้อน';
  $('#bDepth').textContent = S.set.depth ? 'ความลึก : เปิด' : 'ความลึก : ปิด';
}
function setLockEdit(on) {
  lock.classList.toggle('edit', on);
  if (on) { syncPanel(); fitClock(); } else { save(); }
}
$$('#ckStyles button').forEach(b => b.addEventListener('click', () => { S.set.ckStyle = b.dataset.v; fitClock(); syncPanel(); save(); }));
$('#rW').addEventListener('input', e => { S.set.ckW = +e.target.value / 100; fitClock(); save(); });
$('#rH').addEventListener('input', e => { S.set.ckH = +e.target.value; fitClock(); save(); });
$('#bMode').addEventListener('click', () => { S.set.ckMode = S.set.ckMode === 'line' ? 'stack' : 'line'; renderClock(); syncPanel(); save(); });
$('#bDepth').addEventListener('click', () => { S.set.depth = !S.set.depth; applyWall(); syncPanel(); save(); });
$('#bWall').addEventListener('click', () => $('#fWall').click());
$('#bImp').addEventListener('click', () => $('#fCut').click());
$('#bClr').addEventListener('click', async () => { await idb.del('cut'); await loadWall(); toast('ลบการตัดภาพแล้ว'); });
$('#bCut').addEventListener('click', () => {
  if (!wallURL) { toast('เลือกวอลเปเปอร์ก่อน'); return; }
  pickMode = true;
  lock.classList.add('pick');
});
$('#bDone').addEventListener('click', () => setLockEdit(false));
$('#bTorch').addEventListener('click', () => {
  call('toggleTorch').then(r => { if (r) $('#bTorch').classList.toggle('on', !!r.on); else toast('ไฟฉายใช้ไม่ได้'); });
});
$('#bCam').addEventListener('click', () => call('openCamera'));

const hd = $('#ckHandle');
let HD = null;
hd.addEventListener('pointerdown', e => {
  e.stopPropagation();
  try { hd.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  const r = $('#ckIn').getBoundingClientRect();
  HD = { y: e.clientY, H: S.set.ckH, h: r.height };
});
hd.addEventListener('pointermove', e => {
  if (!HD) return;
  const nh = Math.max(40, HD.h + (e.clientY - HD.y));
  S.set.ckH = Math.round(Math.min(420, Math.max(100, HD.H * nh / HD.h)));
  fitClock();
});
hd.addEventListener('pointerup', () => { HD = null; save(); syncPanel(); });
hd.addEventListener('pointercancel', () => { HD = null; });

let LK = null;
lock.addEventListener('pointerdown', e => {
  if (e.target.closest('#lkPanel, #lkBtns, #ckHandle')) return;
  if (pickMode) return;
  try { lock.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  LK = { x: e.clientX, y: e.clientY, dy: 0, moved: false, edit: lock.classList.contains('edit') };
  LK.t = setTimeout(() => {
    if (LK && !LK.moved && !LK.edit) { LK = null; setLockEdit(true); hap('heavy'); }
  }, 520);
});
lock.addEventListener('pointermove', e => {
  if (!LK || LK.edit) return;
  const dy = e.clientY - LK.y, dx = e.clientX - LK.x;
  if (Math.abs(dy) > 8 || Math.abs(dx) > 8) { LK.moved = true; clearTimeout(LK.t); }
  if (LK.moved && dy < 0) {
    LK.dy = dy;
    lock.style.transition = 'none';
    lock.style.transform = 'translateY(' + dy + 'px)';
    lock.style.opacity = String(Math.max(0.3, 1 - Math.abs(dy) / 500));
  }
});
function lockUp(e) {
  if (pickMode && e.type === 'pointerup') {
    pickMode = false;
    lock.classList.remove('pick');
    cutSubject(e.clientX, e.clientY);
    return;
  }
  if (!LK) return;
  clearTimeout(LK.t);
  const g = LK; LK = null;
  if (g.edit) return;
  lock.style.transition = '';
  if (g.dy < -110) unlock();
  else { lock.style.transform = ''; lock.style.opacity = ''; }
}
lock.addEventListener('pointerup', lockUp);
lock.addEventListener('pointercancel', lockUp);

let pRaf = 0;
window.addEventListener('deviceorientation', e => {
  if (!lockVisible() || pRaf) return;
  pRaf = requestAnimationFrame(() => {
    pRaf = 0;
    const g = Math.max(-25, Math.min(25, e.gamma || 0)) / 25;
    const b = Math.max(-25, Math.min(25, (e.beta || 0) - 45)) / 25;
    lock.style.setProperty('--px', g.toFixed(3));
    lock.style.setProperty('--py', b.toFixed(3));
  });
});

/* ---------- Barre de statut ---------- */
const WIFI = '<svg viewBox="0 0 20 15" width="18" height="14"><path d="M10 13.4l2.3-2.5a3.2 3.2 0 0 0-4.6 0z"/><path d="M5.3 8.7a6.6 6.6 0 0 1 9.4 0l1.5-1.6a8.8 8.8 0 0 0-12.4 0z"/><path d="M1.9 5.2a11.4 11.4 0 0 1 16.2 0l1.5-1.6a13.6 13.6 0 0 0-19.2 0z"/></svg>';
const BARS = '<svg viewBox="0 0 18 12" width="18" height="12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>';
let B = { level: 100, charging: false, saver: false };
function updBat() {
  const p = Math.max(0, Math.min(100, Math.round(B.level)));
  const bat = $('#sbBat');
  bat.classList.toggle('chg', !!B.charging);
  bat.classList.toggle('sav', !B.charging && !!B.saver);
  bat.classList.toggle('low', !B.charging && !B.saver && p <= 20);
  bat.classList.toggle('dk', p > 50);
  bat.querySelector('.fill').style.width = p + '%';
  bat.querySelector('b').textContent = S.set.pct ? p : '';
  $('#sbBolt').style.display = B.charging ? 'inline' : 'none';
  updWidgets();
}
function updNet() {
  const c = navigator.connection;
  let t = 'wifi';
  if (!navigator.onLine) t = 'off';
  else if (c && c.type === 'cellular') t = 'cell';
  const n = $('#sbNet');
  n.innerHTML = t === 'wifi' ? WIFI : BARS;
  n.style.opacity = t === 'off' ? '0.35' : '1';
}
let lastMin = '';
function tick() {
  const d = new Date();
  const h = pad(d.getHours()), m = pad(d.getMinutes());
  $('#sbTime').textContent = h + ':' + m;
  if (lastMin !== m) {
    lastMin = m;
    if (lockVisible()) renderClock();
    updWidgets();
  }
}
async function initBattery() {
  const r = await call('getBattery');
  if (r) { B = r; updBat(); }
  else if (navigator.getBattery) {
    try {
      const b = await navigator.getBattery();
      const f = () => { B = { level: b.level * 100, charging: b.charging, saver: false }; updBat(); };
      f(); b.addEventListener('levelchange', f); b.addEventListener('chargingchange', f);
    } catch (e) { /* ignore */ }
  }
  listen('battery', r2 => { if (r2) { B = r2; updBat(); } });
}

/* ---------- Événements natifs ---------- */
listen('home', () => {
  if (lockVisible()) return;
  if (EDIT || overlayOpen()) closeAll();
  else $('#pages').scrollTo({ left: 0, behavior: 'smooth' });
});
listen('screenOff', () => { if (S.set.lockOff) showLock(); });
listen('appsChanged', () => { loadApps(); });
window.addEventListener('online', updNet);
window.addEventListener('offline', updNet);
if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', updNet);

let rt = 0;
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
    if (!DRAG) renderHome();
    fitClock();
  }, 220);
});

/* ---------- Plein écran, barre d'état, launcher par défaut ---------- */
function applyInsets(r) {
  if (!r) return;
  const d = document.documentElement.style;
  d.setProperty('--sat', Math.max(20, r.top || 0) + 'px');
  d.setProperty('--sab', Math.max(0, r.bottom || 0) + 'px');
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  setTimeout(() => { if (!DRAG) renderHome(); fitClock(); }, 60);
}
function applyBar() {
  $('#status').style.display = S.set.ownBar ? '' : 'none';
  call('setStatusBar', { hidden: !!S.set.ownBar });
}
async function checkDefault() {
  if (S.set.defAsked) return;
  const r = await call('isDefaultHome');
  if (r && r.value === false) $('#defBanner').classList.add('on');
}
$('#defYes').addEventListener('click', () => { $('#defBanner').classList.remove('on'); call('requestHome'); });
$('#defNo').addEventListener('click', () => { $('#defBanner').classList.remove('on'); S.set.defAsked = true; save(); });

/* ---------- Démarrage ---------- */
async function boot() {
  applyStyle();
  updNet();
  tick();
  setInterval(tick, 1000);
  await loadWall();
  if (!S.set.lockStart) { lock.classList.add('gone'); $('#app').classList.remove('locked'); }
  requestAnimationFrame(renderClock);
  call('getInsets').then(applyInsets);
  listen('insets', applyInsets);
  applyBar();
  await loadApps();
  initBattery();
  checkDefault();
}
boot();
})();
