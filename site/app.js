// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { DIRECTIONS, MODES, newGame, move, legalMoves, validateState, encodeState, launchFromURL, hashSeed } from './engine.js';
import { bitGlyph } from './glyph.js';

const $ = selector => document.querySelector(selector);
const STORE = '2047.sessions.v1', PREFS = '2047.preferences.v1', BEST = '2047.best.v1';
const url = new URL(location.href);
const saveEnabled = url.searchParams.get('save') !== '0';
const defaults = { controls: true, bits: true, display: 'both', motion: false, theme: 'system' };
let storageOK = true, past = [], future = [], state, sessionKey = 'default', sessions = {}, bestScores = {};
let statusMessage = 'Make your first move.';
const randomSeed = () => Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(16).padStart(8, '0')).join('');

function readStorage(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { storageOK = false; return fallback; }
}

function validPreferences(value) {
  if (!value || typeof value !== 'object') return { ...defaults };
  const display = ['both', 'bits', 'numbers'].includes(value.display) ? value.display : value.bits === false ? 'numbers' : 'both';
  return { controls: typeof value.controls === 'boolean' ? value.controls : true, bits: display !== 'numbers', display, motion: value.motion === true, theme: ['light', 'dark', 'system'].includes(value.theme) ? value.theme : 'system' };
}

let preferences = validPreferences(readStorage(PREFS, defaults));
for (const option of ['controls', 'bits']) if (['0', '1'].includes(url.searchParams.get(option))) preferences[option] = url.searchParams.get(option) === '1';
if (['0', '1'].includes(url.searchParams.get('bits'))) preferences.display = preferences.bits ? 'both' : 'numbers';
if (['both', 'bits', 'numbers'].includes(url.searchParams.get('display'))) preferences.display = url.searchParams.get('display');
preferences.bits = preferences.display !== 'numbers';
if (['light', 'dark', 'system'].includes(url.searchParams.get('theme'))) preferences.theme = url.searchParams.get('theme');
if (url.searchParams.get('motion') === '0') preferences.motion = true;

if (saveEnabled) {
  const stored = readStorage(STORE, {}), scores = readStorage(BEST, {});
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) sessions = stored;
  if (scores && typeof scores === 'object' && !Array.isArray(scores)) bestScores = Object.fromEntries(Object.entries(scores).filter(([key, score]) => /^(classic|insane|2048):[2-8]x[2-8]$/.test(key) && Number.isSafeInteger(score) && score >= 0));
}

try {
  state = launchFromURL(url);
  if (state) {
    sessionKey = 'link-' + hashSeed(encodeState(state)).toString(16);
    statusMessage = 'Challenge loaded. Make it count.';
  }
} catch (error) { statusMessage = `${error.message} Your normal session is unchanged.`; }

if (saveEnabled && sessions[sessionKey]) {
  try {
    const saved = sessions[sessionKey];
    const restored = validateState(saved.state);
    const previous = (Array.isArray(saved.past) ? saved.past : []).slice(-100).map(validateState);
    const next = (Array.isArray(saved.future) ? saved.future : []).slice(-100).map(validateState);
    if ([...previous, ...next].some(s => s.rows !== restored.rows || s.columns !== restored.columns || s.mode !== restored.mode || s.seed !== restored.seed)) throw new Error('Incompatible history.');
    state = restored; past = previous; future = next;
    if (!statusMessage.includes('unchanged')) statusMessage = 'Welcome back. Your game is right here.';
  } catch { statusMessage = 'This saved game could not be read. A fresh board is ready.'; }
}
state ??= newGame({ seed: randomSeed() });

const bestKey = () => `${state.mode}:${state.rows}x${state.columns}`;
function persist() {
  bestScores[bestKey()] = Math.max(bestScores[bestKey()] || 0, state.score);
  if (!saveEnabled) return;
  try {
    sessions[sessionKey] = { state, past, future, updated: Date.now() };
    const keys = Object.keys(sessions).sort((a, b) => (sessions[b]?.updated || 0) - (sessions[a]?.updated || 0));
    for (const key of keys.slice(8)) if (key !== sessionKey) delete sessions[key];
    localStorage.setItem(STORE, JSON.stringify(sessions));
    localStorage.setItem(PREFS, JSON.stringify(preferences));
    localStorage.setItem(BEST, JSON.stringify(bestScores));
    storageOK = true;
  } catch { storageOK = false; }
}

function getState() {
  const available = legalMoves(state);
  return structuredClone({ ...state, highestTile: Math.max(...state.grid), target: state.mode === '2048' ? 2048 : 2047, won: Math.max(...state.grid) >= (state.mode === '2048' ? 2048 : 2047), gameOver: available.length === 0, legalMoves: available, canUndo: past.length > 0, canRedo: future.length > 0, bestScore: Math.max(bestScores[bestKey()] || 0, state.score), persistence: saveEnabled && storageOK ? 'local' : 'session-only', preferences });
}

function applyPreferences() {
  if (preferences.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = preferences.theme;
  document.documentElement.classList.toggle('reduce-motion', preferences.motion);
  $('#direction-pad').hidden = !preferences.controls;
  $('#controls-button').innerHTML = `${preferences.controls ? 'Hide' : 'Show'} controls <span aria-hidden="true">${preferences.controls ? '−' : '+'}</span>`;
  $('#controls-button').setAttribute('aria-expanded', String(preferences.controls));
  $('#controls-setting').checked = preferences.controls;
  $('#display-setting').value = preferences.display;
  $('#motion-setting').checked = preferences.motion;
  $('#theme-setting').value = preferences.theme;
}

function render(effect = {}) {
  persist();
  const snapshot = getState(), board = $('#board');
  applyPreferences();
  $('#score').textContent = state.score.toLocaleString('en-US');
  $('#best').textContent = snapshot.bestScore.toLocaleString('en-US');
  $('#moves').textContent = state.moves.toLocaleString('en-US');
  $('#mode-pill').textContent = state.mode.toUpperCase();
  $('#mode-label').textContent = state.mode === 'classic' ? 'THE BINARY PUZZLE' : `${state.mode.toUpperCase()} MODE`;
  $('#target-label').textContent = snapshot.target;
  $('#session-label').textContent = `${state.rows} × ${state.columns} · ${state.seed}`;
  $('#session-label').title = `Seed: ${state.seed}`;
  $('#save-label').textContent = saveEnabled && storageOK ? 'Saved locally' : 'Session only';
  $('#save-label').title = saveEnabled && storageOK ? 'Saved in this browser' : 'Use Share to keep this game. Local saving is disabled or unavailable.';
  $('#undo-button').disabled = !past.length;
  $('#redo-button').disabled = !future.length;
  document.querySelectorAll('[data-direction]').forEach(button => { button.disabled = !snapshot.legalMoves.includes(button.dataset.direction); });
  $('#end-banner').hidden = !snapshot.gameOver;
  $('#status').textContent = snapshot.gameOver ? 'No moves left. Undo or start a new game.' : statusMessage;
  board.setAttribute('aria-rowcount', state.rows);
  board.setAttribute('aria-colcount', state.columns);
  board.dataset.mode = state.mode;
  board.dataset.score = state.score;
  board.dataset.moves = state.moves;
  board.style.setProperty('--rows', state.rows);
  board.style.setProperty('--columns', state.columns);
  board.style.gridTemplateColumns = `repeat(${state.columns}, minmax(0, 1fr))`;
  board.style.gridTemplateRows = `repeat(${state.rows}, minmax(0, 1fr))`;
  const fragment = document.createDocumentFragment();
  for (let row = 0; row < state.rows; row++) {
    const rowElement = document.createElement('div');
    rowElement.className = 'board-row'; rowElement.setAttribute('role', 'row'); rowElement.setAttribute('aria-rowindex', row + 1);
    for (let column = 0; column < state.columns; column++) {
      const index = row * state.columns + column, value = state.grid[index];
      const cell = document.createElement('div');
      cell.className = 'tile';
      cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-colindex', column + 1);
      cell.dataset.row = row; cell.dataset.column = column; cell.dataset.value = value;
      cell.setAttribute('aria-label', `Row ${row + 1}, column ${column + 1}: ${value || 'empty'}`);
      if (value) {
        cell.dataset.level = Math.min(10, Math.floor(Math.log2(value)));
        cell.dataset.display = preferences.display;
        cell.dataset.bits = value.toString(2);
        if (preferences.display !== 'bits') {
          const number = document.createElement('span');
          number.className = `tile-number${value >= 1e7 ? ' very-long' : value >= 1000 ? ' long' : ''}`;
          number.textContent = value;
          cell.append(number);
        }
        if (preferences.bits) {
          const glyph = bitGlyph(value), panel = document.createElement('span');
          panel.className = 'bit-glyph'; panel.style.setProperty('--bit-side', glyph.side);
          panel.setAttribute('aria-hidden', 'true'); panel.title = `${value} in binary: ${glyph.binary}`;
          for (const bit of glyph.cells) {
            const square = document.createElement('span');
            square.className = `bit-cell is-${bit}`;
            square.dataset.bit = bit;
            if (bit === 'one') square.textContent = '1';
            panel.append(square);
          }
          cell.append(panel);
        }
      }
      if (effect.changed && index === state.lastSpawn) cell.classList.add('spawn');
      if (effect.merged?.includes(index)) cell.classList.add('merge');
      rowElement.append(cell);
    }
    fragment.append(rowElement);
  }
  board.replaceChildren(fragment);
  fitBoard();
  $('#game-state').textContent = JSON.stringify(snapshot);
  window.dispatchEvent(new CustomEvent('game2047:change', { detail: snapshot }));
  return snapshot;
}

function fitBoard() {
  const stacked = matchMedia('(max-width:600px), (min-width:601px) and (orientation:portrait)').matches;
  const layoutStyle = getComputedStyle($('.game-layout'));
  const shellStyle = getComputedStyle($('.app-shell'));
  const height = selector => $(selector)?.getBoundingClientRect().height ?? 0;
  const spacing = Number.parseFloat(layoutStyle.paddingTop) + Number.parseFloat(layoutStyle.paddingBottom)
    + Number.parseFloat(shellStyle.paddingTop) + Number.parseFloat(shellStyle.paddingBottom);
  const reserved = height('.topbar') + height('footer') + spacing + height('.play-area') - height('#board')
    + (stacked ? height('.intro') + Number.parseFloat(layoutStyle.rowGap) : 0);
  const availableHeight = Math.max(170, innerHeight - reserved - 2);
  $('#board').parentElement.style.maxWidth = `min(100%, ${availableHeight * state.columns / state.rows}px)`;
  $('#board').dataset.compact = $('#board').getBoundingClientRect().width / state.columns < 42;
}
window.addEventListener('resize', () => requestAnimationFrame(fitBoard));
window.visualViewport?.addEventListener('resize', () => requestAnimationFrame(fitBoard));

function performMove(direction) {
  const previous = state, result = move(state, direction);
  if (result.changed) {
    past.push(previous); if (past.length > 100) past.shift(); future = [];
    state = result.state;
    const target = state.mode === '2048' ? 2048 : 2047;
    statusMessage = Math.max(...previous.grid) < target && Math.max(...state.grid) >= target ? `${target} reached. Beautifully done — keep going!` : result.gain ? `+${result.gain} · Keep the bits moving.` : 'A little more room.';
  } else statusMessage = `No move ${direction}. Try another direction.`;
  return { changed: result.changed, gain: result.gain, state: render(result) };
}

function undo() {
  if (!past.length) return { changed: false, state: getState() };
  future.push(state); state = past.pop(); statusMessage = 'One step back. A new possibility.';
  return { changed: true, state: render() };
}
function redo() {
  if (!future.length) return { changed: false, state: getState() };
  past.push(state); state = future.pop(); statusMessage = 'Move restored.';
  return { changed: true, state: render() };
}

function startGame(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid game configuration.');
  const next = newGame({ ...config, seed: config.seed?.trim() || randomSeed() });
  state = next; past = []; future = []; sessionKey = 'default';
  const clean = new URL(location.href);
  for (const key of ['seed', 'mode', 'rows', 'cols', 'size', 'moves', 'board', 'score']) clean.searchParams.delete(key);
  clean.hash = '';
  history.replaceState(null, '', clean);
  statusMessage = 'A fresh board. Make your first move.';
  return render();
}

function showDialog(id) {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $(id).showModal();
}
function openNew() {
  const form = $('#new-form');
  form.elements.mode.value = state.mode;
  form.elements.rows.value = state.rows;
  form.elements.columns.value = state.columns;
  form.elements.seed.value = '';
  $('#new-error').textContent = '';
  showDialog('#new-dialog');
}

function shareURL(challenge = false) {
  const link = new URL(location.href);
  link.search = ''; link.hash = '';
  if (challenge) {
    link.searchParams.set('seed', state.seed);
    link.searchParams.set('mode', state.mode);
    link.searchParams.set('rows', state.rows);
    link.searchParams.set('cols', state.columns);
  } else link.hash = 'state=' + encodeState(state);
  return link.href;
}
function openShare(challenge = false) {
  $('#share-url').value = shareURL(challenge);
  $('#share-description').textContent = challenge ? 'Same seed and settings. A fresh board for a friend.' : 'This link includes your board, score, and next spawn sequence.';
  $('#share-feedback').textContent = '';
  $('#challenge-button').hidden = challenge;
  showDialog('#share-dialog');
}

$('#help-button').addEventListener('click', () => showDialog('#help-dialog'));
$('#settings-button').addEventListener('click', () => showDialog('#settings-dialog'));
$('#about-button').addEventListener('click', () => showDialog('#about-dialog'));
$('#title-button').addEventListener('click', () => showDialog('#about-dialog'));
$('#settings-about').addEventListener('click', () => showDialog('#about-dialog'));
$('#new-button').addEventListener('click', openNew);
$('#again-button').addEventListener('click', openNew);
$('#undo-button').addEventListener('click', undo);
$('#redo-button').addEventListener('click', redo);
$('#share-button').addEventListener('click', () => openShare());
$('#export-button').addEventListener('click', () => openShare());
$('#challenge-button').addEventListener('click', () => openShare(true));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => performMove(button.dataset.direction)));
$('#copy-button').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#share-url').value); $('#share-feedback').textContent = 'Copied. Ready to share.'; }
  catch { $('#share-url').focus(); $('#share-url').select(); $('#share-feedback').textContent = 'Select and copy the link above.'; }
});
$('#controls-button').addEventListener('click', () => { preferences.controls = !preferences.controls; render(); });
for (const [selector, property] of [['#controls-setting', 'controls'], ['#display-setting', 'display'], ['#motion-setting', 'motion'], ['#theme-setting', 'theme']]) {
  $(selector).addEventListener('change', event => {
    preferences[property] = ['theme', 'display'].includes(property) ? event.target.value : event.target.checked;
    preferences.bits = preferences.display !== 'numbers';
    const clean = new URL(location.href);
    clean.searchParams.delete(property);
    if (property === 'display') clean.searchParams.delete('bits');
    history.replaceState(null, '', clean);
    render();
  });
}
$('#daily-button').addEventListener('click', () => {
  $('#new-form').elements.seed.value = `daily-${new Date().toISOString().slice(0, 10)}`;
  $('#new-form').elements.mode.value = 'classic';
  $('#new-form').elements.rows.value = 4; $('#new-form').elements.columns.value = 4;
});
$('#new-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    startGame({ mode: form.elements.mode.value, rows: Number(form.elements.rows.value), columns: Number(form.elements.columns.value), seed: form.elements.seed.value });
    $('#new-dialog').close(); $('#board').focus({ preventScroll: true });
  } catch (error) { $('#new-error').textContent = error.message; }
});

document.addEventListener('keydown', event => {
  $('#board').classList.remove('pointer-focus');
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  const key = event.key.toLowerCase(), direction = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', w: 'up', a: 'left', s: 'down', d: 'right' }[key];
  if (direction) { event.preventDefault(); performMove(direction); }
  else if (['z', 'y', 'n', '?'].includes(key)) {
    event.preventDefault();
    if (event.repeat) return;
    if (key === 'z') event.shiftKey ? redo() : undo();
    if (key === 'y') redo();
    if (key === 'n') openNew();
    if (key === '?') showDialog('#help-dialog');
  }
});

let pointer = null;
$('#board').addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  event.currentTarget.classList.add('pointer-focus');
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.focus({ preventScroll: true });
});
$('#board').addEventListener('pointerup', event => {
  if (!pointer || event.pointerId !== pointer.id) return;
  const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
  pointer = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
  performMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});
$('#board').addEventListener('pointercancel', () => { pointer = null; });
$('#board').addEventListener('lostpointercapture', () => { pointer = null; });
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

const api = Object.freeze({
  version: 1, getState,
  move(direction) {
    if (document.querySelector('dialog[open]')) throw new Error('Close the open dialog before moving.');
    return performMove(direction);
  },
  newGame: startGame, undo, redo,
  shareURL(options = {}) { return shareURL(options.challenge === true); }
});
Object.defineProperty(window, 'game2047', { value: api, writable: false, configurable: false });
render();

const registry = document.modelContext ?? navigator.modelContext;
if (typeof registry?.registerTool === 'function') {
  const definitions = [
    { name: 'game2047_get_state', description: 'Read the 2047 board, score, legal moves, and undo availability.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => api.getState() },
    { name: 'game2047_move', description: 'Slide the 2047 board one step. Returns the updated board after any merge and spawn.', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: DIRECTIONS } }, required: ['direction'], additionalProperties: false }, execute: input => api.move(input?.direction) },
    { name: 'game2047_new_game', description: 'Replace the current 2047 session with a new game. Existing progress in this session is replaced.', inputSchema: { type: 'object', properties: { seed: { type: 'string', maxLength: 128 }, mode: { type: 'string', enum: MODES }, rows: { type: 'integer', minimum: 2, maximum: 8 }, columns: { type: 'integer', minimum: 2, maximum: 8 } }, additionalProperties: false }, execute: input => api.newGame(input) },
    { name: 'game2047_undo', description: 'Undo one move in the current 2047 game.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => api.undo() },
    { name: 'game2047_redo', description: 'Restore one previously undone 2047 move.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => api.redo() }
  ];
  for (const tool of definitions) {
    try {
      const execute = tool.execute;
      Promise.resolve(registry.registerTool({ ...tool, execute(input) {
        try {
          if (input === null || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !(key in tool.inputSchema.properties))) throw new Error('Invalid tool arguments.');
          return { content: [{ type: 'text', text: JSON.stringify(execute(input)) }] };
        } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
      } })).catch(() => {});
    } catch { /* Standard controls and the documented interface remain available. */ }
  }
}
