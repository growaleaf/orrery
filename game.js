import * as G from './gears.mjs';

const STORAGE_KEY = 'orrery_v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt storage */ }
  return null;
}
function saveState(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ seed: s.seed, commissionIndex: s.commissionIndex, results: s.results }));
  } catch (e) { /* storage unavailable — session still playable */ }
}

function freshSeed() {
  return Math.floor(Math.random() * 0xFFFFFFFF);
}

const saved = loadState();
const state = {
  seed: saved?.seed ?? freshSeed(),
  commissionIndex: saved?.commissionIndex ?? 0,
  results: saved?.results ?? [],
  phase: 'title',
  stock: null,
  train: [],           // ordered array of gear ids (even length = complete pairs)
  pendingDriver: null,  // gear id chosen as driver, awaiting its driven partner
  spinAnim: null,       // { start, duration, verdict } while animating the dial
};

function currentCommission() { return G.COMMISSIONS[state.commissionIndex]; }

function ensureStock() {
  const c = currentCommission();
  if (!c) return;
  if (!state.stock || state.stock._forId !== c.id) {
    const s = G.generateStock(state.seed, c);
    s._forId = c.id;
    state.stock = s;
    state.train = [];
    state.pendingDriver = null;
  }
}

// ---------------- rendering ----------------

const $ = (id) => document.getElementById(id);
const screens = ['title-screen', 'howto-screen', 'bench-screen', 'spin-screen', 'complete-screen'];

function showScreen(name) {
  state.phase = name;
  for (const id of screens) $(id).classList.toggle('active', id === `${name}-screen`);
  render();
}

function usedGearIds() { return new Set(state.train.map((_, i) => state._trainIds ? state._trainIds[i] : null)); }

function render() {
  if (state.phase === 'bench') renderBench();
  if (state.phase === 'spin') renderSpinStatic();
  if (state.phase === 'complete') renderComplete();
}

function renderBench() {
  ensureStock();
  const c = currentCommission();
  const target = G.commissionTarget(c);

  $('commission-name').textContent = c.name;
  $('commission-index').textContent = `${state.commissionIndex + 1} / ${G.COMMISSIONS.length}`;
  $('commission-target').textContent = `target ${c.days} days · tolerance 1 in ${c.tol[1]} · par ${state.stock.parGearCount} gears`;

  // stock grid
  const grid = $('stock-grid');
  grid.innerHTML = '';
  const usedIds = new Set(state._trainGearIds || []);
  for (const g of state.stock.gears) {
    const chip = document.createElement('div');
    chip.className = 'gear-chip' + (usedIds.has(g.id) ? ' used' : '') + (state.pendingDriver === g.id ? ' selected' : '');
    chip.textContent = g.teeth;
    chip.setAttribute('role', 'button');
    chip.setAttribute('aria-label', `gear with ${g.teeth} teeth`);
    if (!usedIds.has(g.id)) chip.addEventListener('click', () => tapGear(g.id));
    grid.appendChild(chip);
  }

  // train strip
  const strip = $('train-strip');
  strip.innerHTML = '';
  if (state.train.length === 0) {
    strip.innerHTML = '<span class="muted">no gears chosen yet</span>';
  } else {
    state.train.forEach((teeth, i) => {
      if (i > 0 && i % 2 === 0) {
        const sep = document.createElement('span');
        sep.className = 'train-sep'; sep.textContent = '·';
        strip.appendChild(sep);
      }
      const el = document.createElement('span');
      el.className = 'train-tooth';
      el.textContent = teeth;
      strip.appendChild(el);
      if (i % 2 === 0) {
        const arrow = document.createElement('span');
        arrow.className = 'train-sep'; arrow.textContent = '→';
        strip.appendChild(arrow);
      }
    });
  }

  if (state.train.length >= 2 && state.train.length % 2 === 0) {
    const ratio = G.trainRatio(state.train);
    const rel = G.relErrorFrac(ratio, target);
    $('train-ratio').textContent = `${G.fracToFloat(ratio).toFixed(4)} (err ${(G.fracToFloat(rel) * 100).toFixed(3)}%)`;
    $('btn-spin').disabled = false;
  } else {
    $('train-ratio').textContent = '—';
    $('btn-spin').disabled = true;
  }
}

function renderSpinStatic() {
  drawDial(0);
  $('verdict-card').style.display = 'none';
  $('btn-spin-retry').style.display = 'none';
  $('btn-spin-next').style.display = 'none';
}

function renderComplete() {
  const totalScore = state.results.reduce((a, r) => a + r.score, 0);
  const passed = state.results.filter(r => r.pass).length;
  $('complete-summary').textContent = `${passed} of ${state.results.length} commissions passed the clockmaker's eye. Total score ${totalScore}.`;
  const last = state.results[state.results.length - 1];
  const shareLine = last
    ? `Orrery · ${last.name} train ${last.pairCount} gears off by ${last.driftLabel} · ${last.pass ? 'the clockmaker bows' : 'the clockmaker sighs'} · http://orrery.defimagic.io`
    : 'Orrery · http://orrery.defimagic.io';
  $('share-text').textContent = shareLine;
}

// ---------------- canvas: dial ----------------

function drawDial(progress) {
  const canvas = $('dialCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0d1122';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 20;

  ctx.strokeStyle = '#8a6f2a';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8));
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }

  const anim = state.spinAnim;
  const trueTurns = progress * 3;      // true hand: fixed reference speed
  const scale = anim ? anim.scale : 1;  // achieved/target ratio drives relative speed
  const achievedTurns = progress * 3 * scale;

  drawHand(ctx, cx, cy, r * 0.8, trueTurns, '#6f9a5e', 3);
  drawHand(ctx, cx, cy, r * 0.6, achievedTurns, '#e8c766', 4);

  ctx.fillStyle = '#9a917d';
  ctx.font = '13px Georgia';
  ctx.fillText('green — the true sky', 10, h - 28);
  ctx.fillText('gold — your gearing', 10, h - 10);
}

function drawHand(ctx, cx, cy, len, turns, color, width) {
  const a = (turns % 1) * Math.PI * 2 - Math.PI / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
  ctx.stroke();
}

// ---------------- interaction ----------------

function tapGear(gearId) {
  const gear = state.stock.gears.find(g => g.id === gearId);
  if (!gear) return;
  state.train.push(gear.teeth);
  state._trainGearIds = state._trainGearIds || [];
  state._trainGearIds.push(gearId);
  renderBench();
}

function clearTrain() {
  state.train = [];
  state._trainGearIds = [];
  renderBench();
}

function showHint() {
  const c = currentCommission();
  const target = G.commissionTarget(c);
  const conv = G.convergents(target, 8);
  const best = conv[conv.length - 1] || conv[conv.length - 2];
  const el = $('hint-text');
  if (best) {
    el.textContent = `the apprentice murmurs: ${best.p}/${best.q} — find the teeth for that, in stages.`;
    el.style.display = 'block';
  }
}

let spinRAF = null;
function step(now, startTime, durationMs) {
  const t = Math.min(1, (now - startTime) / durationMs);
  drawDial(t);
  return t;
}

function spin(injectedNow) {
  const c = currentCommission();
  const target = G.commissionTarget(c);
  const tol = G.commissionTol(c);
  const ratio = G.trainRatio(state.train);
  const pass = G.withinTolerance(ratio, target, tol);
  const drift = G.driftDaysFrac(ratio, target, c.years);
  const label = G.driftLabel(drift);
  const gearCount = state.train.length;
  const score = pass ? G.scoreForGearCount(gearCount, state.stock.parGearCount) : 0;
  const verdict = pass ? G.verdictLabel(gearCount, state.stock.parGearCount) : 'the drift is too great — try again';

  const result = { name: c.name, pass, score, driftLabel: label, pairCount: gearCount / 2, gearCount };
  state.spinAnim = { scale: G.fracToFloat(ratio) / G.fracToFloat(target), verdict, drift: label, pass, score, result };

  showScreen('spin');
  $('spin-title').textContent = `${c.name} — ${c.years} simulated years`;

  const durationMs = injectedNow !== undefined ? 0 : 1800;
  const start = injectedNow !== undefined ? injectedNow : performance.now();

  function tick(now) {
    const t = step(now, start, durationMs);
    if (t < 1) {
      spinRAF = requestAnimationFrame(tick);
    } else {
      finishSpin();
    }
  }
  if (durationMs === 0) {
    drawDial(1);
    finishSpin();
  } else {
    spinRAF = requestAnimationFrame(tick);
  }
}

function finishSpin() {
  const anim = state.spinAnim;
  if (!anim) return;
  $('verdict-card').style.display = 'block';
  $('verdict-verdict').textContent = anim.verdict;
  $('verdict-verdict').className = anim.pass ? 'verdict-pass' : 'verdict-fail';
  $('verdict-drift').textContent = `drift over the run: ${anim.drift}`;
  $('verdict-score').textContent = anim.pass ? `score ${anim.score} (${anim.result.gearCount} gears, par ${state.stock.parGearCount})` : '';

  if (anim.pass) {
    state.results.push(anim.result);
    saveState(state);
    $('btn-spin-next').style.display = 'inline-block';
  } else {
    $('btn-spin-retry').style.display = 'inline-block';
  }
}

function nextCommission() {
  state.commissionIndex++;
  saveState(state);
  state.stock = null;
  if (state.commissionIndex >= G.COMMISSIONS.length) {
    showScreen('complete');
  } else {
    showScreen('bench');
  }
}

function retrySpin() {
  clearTrain();
  showScreen('bench');
}

function restartBench() {
  state.seed = freshSeed();
  state.commissionIndex = 0;
  state.results = [];
  state.stock = null;
  saveState(state);
  showScreen('title');
}

// ---------------- wiring ----------------

$('btn-start').addEventListener('click', () => showScreen('bench'));
$('btn-howto').addEventListener('click', () => showScreen('howto'));
$('btn-howto-back').addEventListener('click', () => showScreen('title'));
$('btn-howto-start').addEventListener('click', () => showScreen('bench'));
$('btn-bench-back').addEventListener('click', () => showScreen('title'));
$('btn-clear-train').addEventListener('click', clearTrain);
$('btn-hint').addEventListener('click', showHint);
$('btn-spin').addEventListener('click', () => spin());
$('btn-spin-retry').addEventListener('click', retrySpin);
$('btn-spin-next').addEventListener('click', nextCommission);
$('btn-complete-restart').addEventListener('click', restartBench);
$('btn-copy-share').addEventListener('click', () => {
  const text = $('share-text').textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
});

if (state.commissionIndex >= G.COMMISSIONS.length && state.results.length > 0) {
  showScreen('complete');
} else {
  showScreen('title');
}

// ---------------- dev hook (?dev=1): scripted, headless-drivable ----------------

if (new URLSearchParams(location.search).get('dev') === '1') {
  window.__g = {
    state: () => ({
      phase: state.phase,
      seed: state.seed,
      commissionIndex: state.commissionIndex,
      commission: currentCommission()?.id,
      train: state.train.slice(),
      results: state.results.slice(),
      stock: state.stock ? state.stock.gears.map(g => ({ id: g.id, teeth: g.teeth })) : null,
      parGearCount: state.stock ? state.stock.parGearCount : null,
    }),
    goTo: (phase) => showScreen(phase),
    tapGear: (id) => tapGear(id),
    clearTrain: () => clearTrain(),
    buildParTrain: () => {
      ensureStock();
      const c = currentCommission();
      const target = G.commissionTarget(c);
      const tol = G.commissionTol(c);
      const found = G.solverVerify(state.stock.gears, target, tol, state.stock.parGearCount / 2);
      if (!found) return false;
      clearTrain();
      // map found teeth back to specific stock gear ids (first match, one each)
      const pool = state.stock.gears.slice();
      for (const teeth of found) {
        const idx = pool.findIndex(g => g.teeth === teeth);
        if (idx === -1) return false;
        tapGear(pool[idx].id);
        pool.splice(idx, 1);
      }
      return true;
    },
    spin: (now) => spin(now ?? 0),
    finishSpin: () => finishSpin(),
    nextCommission: () => nextCommission(),
    retrySpin: () => retrySpin(),
    restartBench: () => restartBench(),
    setSeed: (seed) => { state.seed = seed; state.stock = null; renderBench(); },
    resetStorage: () => { try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} },
  };
}
