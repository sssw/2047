// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { DIRECTIONS, MODES, configuration, newGame, move, legalMoves, validateState, encodeState, launchFromURL, legacySessionKey, hashSeed } from './engine.js?v=20261014-random2';
import { bitGlyph } from './glyph.js';
import { DEFAULT_DURATION, MILESTONE, duration, createClock, createRound, beginRound, recordRound, expireRound, elapsed, remaining, assessment, formatTime, formatElapsed, validateRound, encodeRound, decodeRound } from './assessment.js?v=20261014-timer2';
import { celebrate, stopCelebration } from './celebration.js?v=20261014-timer2';

const elements = new Map();
const $ = selector => {
  if (!elements.has(selector)) elements.set(selector, document.querySelector(selector));
  return elements.get(selector);
};
const STORE = '2047.sessions.v1', PREFS = '2047.preferences.v1', BEST = '2047.best.v1';
const url = new URL(location.href);
const saveEnabled = url.searchParams.get('save') !== '0';
const defaults = { controls: false, bits: true, display: 'both', motion: false, theme: 'system', sound: true, volume: 0.35, timerDuration: DEFAULT_DURATION };
let storageOK = true, past = [], future = [], state, sessionKey = 'default', sessions = {}, bestScores = {};
let statusMessage = 'Make your first move.';
const gameParameters = ['seed', 'mode', 'rows', 'cols', 'size', 'moves', 'board', 'score', 'timer'];
let previousSessionKey = null;
let round = null, clockTask = null;
let resultDismissed = false, pendingGame = null;
const clockNow = createClock();

function readStorage(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { storageOK = false; return fallback; }
}

function validPreferences(value) {
  if (!value || typeof value !== 'object') return { ...defaults };
  const display = ['both', 'bits', 'numbers'].includes(value.display) ? value.display : value.bits === false ? 'numbers' : 'both';
  return { controls: value.controls === true && value.controlsChosen === true, controlsChosen: value.controlsChosen === true, bits: display !== 'numbers', display, motion: value.motion === true, theme: ['light', 'dark', 'system'].includes(value.theme) ? value.theme : 'system', sound: value.sound !== false, volume: Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1 ? value.volume : .35, timerDuration: Number.isInteger(value.timerDuration) && value.timerDuration >= 1 && value.timerDuration <= 3600 ? value.timerDuration : DEFAULT_DURATION };
}

let preferences = validPreferences(readStorage(PREFS, defaults));
for (const option of ['controls', 'bits']) if (['0', '1'].includes(url.searchParams.get(option))) preferences[option] = url.searchParams.get(option) === '1';
if (['0', '1'].includes(url.searchParams.get('controls'))) preferences.controlsChosen = true;
if (['0', '1'].includes(url.searchParams.get('sound'))) preferences.sound = url.searchParams.get('sound') === '1';
if (url.searchParams.has('volume') && Number.isFinite(Number(url.searchParams.get('volume'))) && Number(url.searchParams.get('volume')) >= 0 && Number(url.searchParams.get('volume')) <= 1) preferences.volume = Number(url.searchParams.get('volume'));
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
  if (url.hash.startsWith('#round=')) {
    const linked = decodeRound(url.hash.slice(7)); state = linked.game; round = linked.round;
  } else {
    if (url.searchParams.has('timer') && !/^\d{1,4}$/.test(url.searchParams.get('timer'))) throw new Error('Timer must be a whole number of seconds.');
    const seconds = duration(Number(url.searchParams.get('timer') ?? 0));
    state = launchFromURL(url) ?? (url.searchParams.has('timer') ? newGame() : null);
    if (state) round = createRound(state, seconds);
  }
  if (state) {
    const identity = url.hash.startsWith('#round=') ? encodeRound(state, round) : url.hash.startsWith('#state=') ? encodeState(state)
      : JSON.stringify(gameParameters.filter(key => url.searchParams.has(key)).map(key => [key, url.searchParams.get(key)]));
    sessionKey = 'link2-' + hashSeed(identity).toString(16);
    if (saveEnabled && !sessions[sessionKey] && !url.searchParams.has('timer') && !url.hash.startsWith('#round=')) {
      // Snapshot saves used an earlier key even after version 1.
      const snapshotKey = 'link-' + hashSeed(encodeState(state)).toString(16);
      if (sessions[snapshotKey]) previousSessionKey = snapshotKey;
      else if (Object.values(sessions).some(saved => saved?.state?.version === 1)) previousSessionKey = legacySessionKey(url);
    }
    statusMessage = 'Challenge loaded. Make it count.';
  }
} catch (error) { statusMessage = `${error.message} Your normal session is unchanged.`; }

if (saveEnabled && (sessions[sessionKey] || sessions[previousSessionKey])) {
  try {
    const saved = sessions[sessionKey] || sessions[previousSessionKey];
    const restored = validateState(saved.state);
    const previous = (Array.isArray(saved.past) ? saved.past : []).slice(-100).map(validateState);
    const next = (Array.isArray(saved.future) ? saved.future : []).slice(-100).map(validateState);
    const restoredRound = validateRound(saved.round, restored);
    if ([...previous, ...next].some(s => s.rows !== restored.rows || s.columns !== restored.columns || s.mode !== restored.mode || s.seed !== restored.seed || s.randomness !== restored.randomness)) throw new Error('Incompatible history.');
    state = restored; past = previous; future = next; round = restoredRound;
    if (!statusMessage.includes('unchanged')) statusMessage = 'Welcome back. Your game is right here.';
  } catch { statusMessage = 'This saved game could not be read. A fresh board is ready.'; }
}
state ??= newGame();
round ??= createRound(state);

const bestKey = () => `${state.mode}:${state.rows}x${state.columns}`;
let saveTask = null, saveDirty = false, queuedState = null, queuedRound = null, queuedHistory = '', savedPreferences = '', savedBest = '';
function flushSave() {
  if (saveTask) {
    if (saveTask.idle) cancelIdleCallback(saveTask.id);
    else clearTimeout(saveTask.id);
    saveTask = null;
  }
  if (!saveEnabled || !saveDirty) return;
  saveDirty = false;
  try {
    sessions[sessionKey] = { state, past, future, round, updated: Date.now() };
    const keys = Object.keys(sessions).sort((a, b) => (sessions[b]?.updated || 0) - (sessions[a]?.updated || 0));
    for (const key of keys.slice(8)) if (key !== sessionKey) delete sessions[key];
    localStorage.setItem(STORE, JSON.stringify(sessions));
    const prefText = JSON.stringify(preferences), bestText = JSON.stringify(bestScores);
    if (prefText !== savedPreferences) { localStorage.setItem(PREFS, prefText); savedPreferences = prefText; }
    if (bestText !== savedBest) { localStorage.setItem(BEST, bestText); savedBest = bestText; }
    storageOK = true;
  } catch { storageOK = false; }
  $('#save-label').textContent = storageOK ? 'Saved locally' : 'Session only';
  $('#save-label').title = storageOK ? 'Saved in this browser' : 'Use Share to keep this game. Local storage is unavailable.';
}

function persist() {
  bestScores[bestKey()] = Math.max(bestScores[bestKey()] || 0, state.score);
  if (!saveEnabled) return;
  const signature = `${past.length}:${future.length}:${JSON.stringify(preferences)}`;
  if (queuedState === state && queuedRound === round && queuedHistory === signature) return;
  queuedState = state; queuedRound = round; queuedHistory = signature; saveDirty = true;
  if (!saveTask) {
    saveTask = typeof requestIdleCallback === 'function'
      ? { idle: true, id: requestIdleCallback(flushSave, { timeout: 200 }) }
      : { idle: false, id: setTimeout(flushSave, 80) };
  }
}

let legalState = null, cachedMoves = [];
function snapshotState(now = round.startedAt === null ? 0 : clockNow()) {
  if (legalState !== state) { cachedMoves = legalMoves(state); legalState = state; }
  const available = cachedMoves;
  return structuredClone({ ...state, highestTile: Math.max(...state.grid), peakTile: round.maxTile, milestoneReached: round.celebrated,
    target: state.mode === '2048' ? 2048 : 2047, won: Math.max(...state.grid) >= (state.mode === '2048' ? 2048 : 2047),
    gameOver: round.expired || available.length === 0, gameOverReason: round.expired ? 'timeout' : available.length ? null : 'no-moves',
    inputLocked: round.expired, assessment: assessment(round, state, now),
    legalMoves: round.expired ? [] : available, canUndo: !round.expired && past.length > 0, canRedo: !round.expired && future.length > 0,
    bestScore: Math.max(bestScores[bestKey()] || 0, state.score), persistence: saveEnabled && storageOK ? 'local' : 'session-only', preferences });
}

function refreshDeadline(now) {
  if (round.deadline === null || round.expired) return false;
  const next = expireRound(round, now ?? clockNow());
  if (next === round) return false;
  round = next;
  statusMessage = `Time’s up · Max tile ${numberFormat.format(round.maxTile)} · Score ${numberFormat.format(state.score)}`;
  return true;
}

function getState() {
  const now = round.startedAt === null ? 0 : clockNow();
  if (refreshDeadline(now)) render();
  return snapshotState(now);
}

function paintTimer(snapshot) {
  const timed = snapshot.assessment, button = $('#timer-button'), display = $('#timer-display');
  const countingUp = !timed.enabled && timed.startedAt !== null;
  display.textContent = timed.enabled ? formatTime(timed.remainingMs) : countingUp ? formatElapsed(timed.elapsedMs) : 'Off';
  const digits = String(display.textContent.length);
  if (display.style.getPropertyValue('--digits') !== digits) display.style.setProperty('--digits', digits);
  $('#timer-label').textContent = countingUp ? 'ELAPSED' : timed.status === 'finished' ? 'TIME UP' : timed.status === 'ready' ? 'READY' : 'TIMER';
  button.dataset.status = countingUp ? 'elapsed' : timed.status;
  button.dataset.urgent = timed.status === 'running' && timed.remainingMs <= 10000;
  button.setAttribute('aria-label', countingUp ? `Elapsed ${display.textContent}. Timer settings.`
    : timed.status === 'finished' ? 'Time is up. View result or start a timed round.'
    : timed.status === 'ready' ? `Ready for ${display.textContent}. Countdown starts after your first valid move. Timer settings.`
    : timed.enabled ? `Countdown ${display.textContent} remaining. Timer settings.` : 'Countdown off. Elapsed time starts after your first valid move. Timer settings.');
  button.title = timed.startedAt !== null ? 'Time keeps running in menus and other tabs.'
    : timed.enabled ? 'Ready · countdown starts after your first valid move' : 'Elapsed time starts after your first valid move · tap for a time limit';
}

function scheduleClock() {
  clearTimeout(clockTask); clockTask = null;
  if (round.startedAt === null || round.expired || document.hidden) return;
  const now = clockNow(), ms = remaining(round, now);
  const delay = ms === null ? 1000 - elapsed(round, now) % 1000 : Math.min(ms, ms % 1000 || 1000);
  clockTask = setTimeout(() => {
    if (refreshDeadline()) { render(); return; }
    const snapshot = snapshotState();
    paintTimer(snapshot);
    $('#game-state').textContent = JSON.stringify(snapshot);
    window.dispatchEvent(new CustomEvent('game2047:timer', { detail: snapshot.assessment }));
    scheduleClock();
  }, Math.max(1, delay));
}

function roundLocked() {
  if (refreshDeadline()) render();
  return round.expired;
}

let appliedPreferences = '';
function applyPreferences() {
  const signature = JSON.stringify(preferences);
  if (signature === appliedPreferences) return false;
  appliedPreferences = signature;
  if (preferences.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = preferences.theme;
  document.documentElement.classList.toggle('reduce-motion', preferences.motion);
  if (preferences.motion) stopCelebration($('#celebration'));
  $('#direction-pad').hidden = !preferences.controls;
  $('.direction-section').hidden = !preferences.controls;
  $('#controls-button').innerHTML = `${preferences.controls ? 'Hide' : 'Show'} controls <span aria-hidden="true">${preferences.controls ? '−' : '+'}</span>`;
  $('#controls-button').setAttribute('aria-expanded', String(preferences.controls));
  $('#controls-setting').checked = preferences.controls;
  $('#display-setting').value = preferences.display;
  $('#motion-setting').checked = preferences.motion;
  $('#theme-setting').value = preferences.theme;
  $('#sound-setting').checked = preferences.sound;
  $('#volume-setting').value = Math.round(preferences.volume * 100);
  $('#volume-output').textContent = `${Math.round(preferences.volume * 100)}%`;
  updateSoundLabel();
  return true;
}

let audioContext = null, lastSoundAt = -1;
function updateSoundLabel() {
  $('#sound-status').textContent = !preferences.sound || preferences.volume === 0 ? 'Sound is off.' : audioContext?.state === 'running' ? 'Sound is on.' : 'Sound starts with your first tap or key press.';
}
function unlockAudio() {
  if (!preferences.sound || preferences.volume === 0) return Promise.resolve(false);
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return Promise.resolve(false);
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return Promise.resolve(false);
    audioContext ??= new Context({ latencyHint: 'interactive' });
    const ready = audioContext.state === 'suspended' ? audioContext.resume() : Promise.resolve();
    return ready.then(() => { updateSoundLabel(); return audioContext.state === 'running'; }).catch(() => false);
  } catch { return Promise.resolve(false); }
}
function playSound(gain = 0, won = false) {
  if (!preferences.sound || preferences.volume === 0) return;
  void unlockAudio().then(ready => {
    if (!ready || !preferences.sound || preferences.volume === 0) return;
    const now = audioContext.currentTime;
    if (now - lastSoundAt < .035) return;
    lastSoundAt = now;
    const frequency = gain ? 440 * 2 ** ((Math.floor(Math.log2(gain)) % 6) / 12) : 440;
    const notes = won ? [1, 1.25, 1.5] : gain ? [1, 1.5] : [1];
    notes.forEach((ratio, index) => {
      const start = now + index * .035, duration = gain ? .13 : .055;
      const oscillator = audioContext.createOscillator(), envelope = audioContext.createGain();
      oscillator.type = gain ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency * ratio, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * ratio * .92, start + duration);
      envelope.gain.setValueAtTime(.0001, start);
      envelope.gain.exponentialRampToValueAtTime(preferences.volume * (gain ? .32 : .20), start + .005);
      envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(envelope); envelope.connect(audioContext.destination);
      oscillator.start(start); oscillator.stop(start + duration + .01);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    });
  });
}

let renderedShape = '', renderedDisplay = '', cells = [];
const numberFormat = new Intl.NumberFormat('en-US');
const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)');
const glyphTemplates = new Map();
const tileAnimations = new WeakMap();
function glyphElement(value) {
  if (!glyphTemplates.has(value)) {
    const glyph = bitGlyph(value), panel = document.createElement('span');
    panel.className = 'bit-glyph'; panel.style.setProperty('--bit-side', glyph.side);
    panel.setAttribute('aria-hidden', 'true'); panel.title = `${value} in binary: ${glyph.binary}`;
    for (const bit of glyph.cells) {
      const square = document.createElement('span');
      square.className = `bit-cell is-${bit}`; square.dataset.bit = bit;
      if (bit === 'one') square.textContent = '1';
      panel.append(square);
    }
    if (glyphTemplates.size >= 256) glyphTemplates.delete(glyphTemplates.keys().next().value);
    glyphTemplates.set(value, panel);
  }
  return glyphTemplates.get(value).cloneNode(true);
}

function render(effect = {}) {
  refreshDeadline();
  persist();
  const snapshot = snapshotState(), board = $('#board');
  const preferencesChanged = applyPreferences();
  $('#score').textContent = numberFormat.format(state.score);
  $('#best').textContent = numberFormat.format(snapshot.bestScore);
  $('#moves').textContent = numberFormat.format(state.moves);
  for (const selector of ['#score', '#best', '#moves']) {
    const element = $(selector), digits = String(element.textContent.length);
    element.title = element.textContent;
    if (element.style.getPropertyValue('--digits') !== digits) element.style.setProperty('--digits', digits);
  }
  paintTimer(snapshot);
  $('#mode-pill').textContent = state.mode.toUpperCase();
  $('#mode-pill').setAttribute('aria-label', `${state.mode} mode. Open new game settings.`);
  $('#mode-label').textContent = state.mode === 'classic' ? 'THE BINARY PUZZLE' : `${state.mode.toUpperCase()} MODE`;
  $('#target-label').textContent = snapshot.target;
  $('#session-label').textContent = `${state.rows} × ${state.columns} · ${state.randomness === 'random' ? 'Random' : state.seed}`;
  $('#session-label').title = state.randomness === 'random' ? 'Fresh random tiles each move' : `Seed: ${state.seed}`;
  $('#randomness-status').textContent = state.randomness === 'random' ? 'Random · fresh tiles each move' : `Seeded · ${state.seed}`;
  $('#save-label').textContent = saveEnabled && storageOK ? (saveDirty ? 'Autosave on' : 'Saved locally') : 'Session only';
  $('#save-label').title = saveEnabled && storageOK ? 'Saved in this browser' : 'Use Share to keep this game. Local saving is disabled or unavailable.';
  $('#undo-button').disabled = !snapshot.canUndo;
  $('#redo-button').disabled = !snapshot.canRedo;
  document.querySelectorAll('[data-direction]').forEach(button => { button.disabled = !snapshot.legalMoves.includes(button.dataset.direction); });
  $('#end-banner').hidden = !snapshot.gameOver || round.durationSeconds > 0;
  $('#status').textContent = round.expired ? `Time’s up · Max tile ${numberFormat.format(round.maxTile)} · Score ${numberFormat.format(state.score)}` : snapshot.gameOver ? 'No moves left. Undo or start a new game.' : statusMessage;
  $('#status').title = $('#status').textContent;
  board.setAttribute('aria-disabled', String(snapshot.inputLocked));
  board.dataset.mode = state.mode;
  board.dataset.score = state.score;
  board.dataset.moves = state.moves;
  const shape = `${state.rows}x${state.columns}`, shapeChanged = shape !== renderedShape;
  if (shapeChanged) {
    board.setAttribute('aria-rowcount', state.rows); board.setAttribute('aria-colcount', state.columns);
    board.style.setProperty('--rows', state.rows); board.style.setProperty('--columns', state.columns);
    board.style.gridTemplateColumns = `repeat(${state.columns}, minmax(0, 1fr))`;
    board.style.gridTemplateRows = `repeat(${state.rows}, minmax(0, 1fr))`;
    const fragment = document.createDocumentFragment(); cells = [];
    for (let row = 0; row < state.rows; row++) {
      const rowElement = document.createElement('div');
      rowElement.className = 'board-row'; rowElement.setAttribute('role', 'row'); rowElement.setAttribute('aria-rowindex', row + 1);
      for (let column = 0; column < state.columns; column++) {
        const cell = document.createElement('div'); cell.className = 'tile';
        cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-colindex', column + 1);
        cell.dataset.row = row; cell.dataset.column = column;
        rowElement.append(cell); cells.push(cell);
      }
      fragment.append(rowElement);
    }
    board.replaceChildren(fragment); renderedShape = shape;
  }
  state.grid.forEach((value, index) => {
    const cell = cells[index], row = Math.floor(index / state.columns), column = index % state.columns;
    if (cell.dataset.value !== String(value) || renderedDisplay !== preferences.display) {
      tileAnimations.get(cell)?.cancel();
      cell.replaceChildren(); cell.dataset.value = value;
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
        if (preferences.bits) cell.append(glyphElement(value));
      } else {
        delete cell.dataset.level; delete cell.dataset.display; delete cell.dataset.bits;
      }
    }
    if (!preferences.motion && !reducedMotion.matches && effect.changed) {
      if (index === state.lastSpawn || effect.merged?.includes(index)) {
        tileAnimations.get(cell)?.cancel();
        const frames = index === state.lastSpawn
          ? [{ transform: 'scale(.86)', opacity: .6 }, { transform: 'scale(1)', opacity: 1 }]
          : [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }];
        tileAnimations.set(cell, cell.animate(frames, { duration: 150, easing: 'ease-out' }));
      }
    }
  });
  renderedDisplay = preferences.display;
  if (shapeChanged || preferencesChanged) fitBoard();
  paintResult(snapshot);
  $('#game-state').textContent = JSON.stringify(snapshot);
  window.dispatchEvent(new CustomEvent('game2047:change', { detail: snapshot }));
  scheduleClock();
  return snapshot;
}

function fitBoard() {
  const sideBySide = matchMedia('(orientation:landscape) and (min-width:480px)').matches;
  const intro = $('.intro'), playArea = $('.play-area');
  const scorebar = $('.scorebar'), tools = $('.game-tools'), status = $('.status');
  const roundTools = $('.round-tools');
  if (sideBySide && scorebar.parentElement !== intro) {
    intro.append(scorebar, status, roundTools); $('.intro-heading').append(tools);
  } else if (!sideBySide && scorebar.parentElement !== playArea) {
    playArea.prepend(scorebar); scorebar.append(tools); playArea.append(status); $('.intro-heading').append(roundTools);
  }
  const shell = $('.app-shell'), layout = $('.game-layout'), board = $('#board');
  const shellStyle = getComputedStyle(shell), layoutStyle = getComputedStyle(layout);
  const pixels = value => Number.parseFloat(value) || 0;
  const outerHeight = element => {
    const style = getComputedStyle(element);
    return style.display === 'none' ? 0 : element.getBoundingClientRect().height + pixels(style.marginTop) + pixels(style.marginBottom);
  };
  const reserved = pixels(shellStyle.paddingTop) + pixels(shellStyle.paddingBottom) + outerHeight($('footer'))
    + pixels(layoutStyle.paddingTop) + pixels(layoutStyle.paddingBottom)
    + (sideBySide ? 0 : outerHeight(intro) + pixels(layoutStyle.rowGap) + outerHeight(scorebar) + outerHeight(status));
  // Measure the dynamic viewport, including Safari's expanded toolbar and safe areas.
  // Pinch zoom stays available and does not resize the underlying game layout.
  const viewportHeight = window.visualViewport?.scale === 1 ? Math.min(innerHeight, visualViewport.height) : innerHeight;
  const availableHeight = Math.max(0, Math.min(shell.clientHeight, viewportHeight) - reserved - 1);
  const width = Math.min(playArea.clientWidth, availableHeight * state.columns / state.rows);
  board.parentElement.style.width = `${Math.floor(width * 100) / 100}px`;
  board.dataset.compact = width / state.columns < 42;
  positionResult();
}
let fitFrame = 0;
function scheduleFit() {
  if (fitFrame) return;
  fitFrame = requestAnimationFrame(() => { fitFrame = 0; fitBoard(); });
}
window.addEventListener('resize', scheduleFit);
window.visualViewport?.addEventListener('resize', scheduleFit);
window.addEventListener('pageshow', scheduleFit);

function performMove(direction) {
  if (roundLocked()) return { changed: false, gain: 0, reason: 'timeout', state: snapshotState() };
  const previous = state, result = move(state, direction);
  // Check again before committing: a slow caller cannot finish a move after time is up.
  if (roundLocked()) return { changed: false, gain: 0, reason: 'timeout', state: snapshotState() };
  let milestone = false;
  if (result.changed) {
    past.push(previous); if (past.length > 100) past.shift(); future = [];
    state = result.state;
    round = beginRound(round, clockNow());
    const recorded = recordRound(round, state, 'move'); round = recorded.round; milestone = recorded.milestone;
    statusMessage = milestone ? `${Math.max(...state.grid)} reached. Keep going!` : result.gain ? `+${result.gain} · Keep the bits moving.` : 'A little more room.';
    playSound(result.gain, milestone);
  } else statusMessage = `No move ${direction}. Try another direction.`;
  const snapshot = render(result);
  if (milestone) celebrateMilestone();
  return { changed: result.changed, gain: result.gain, state: snapshot };
}

function celebrateMilestone() {
  celebrate($('#celebration'), preferences.motion || reducedMotion.matches);
  window.dispatchEvent(new CustomEvent('game2047:milestone', { detail: { target: MILESTONE, maxTile: round.maxTile } }));
}

function undo() {
  if (roundLocked()) return { changed: false, reason: 'timeout', state: snapshotState() };
  if (!past.length) return { changed: false, state: getState() };
  future.push(state); state = past.pop(); statusMessage = 'One step back. A new possibility.';
  round = recordRound(round, state, 'undo').round;
  return { changed: true, state: render() };
}
function redo() {
  if (roundLocked()) return { changed: false, reason: 'timeout', state: snapshotState() };
  if (!future.length) return { changed: false, state: getState() };
  past.push(state); state = future.pop(); statusMessage = 'Move restored.';
  const recorded = recordRound(round, state, 'redo'); round = recorded.round;
  const snapshot = render();
  if (recorded.milestone) celebrateMilestone();
  return { changed: true, state: snapshot };
}

function startGame(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid game configuration.');
  if (config.confirm !== undefined && typeof config.confirm !== 'boolean') throw new Error('Confirmation must be true or false.');
  const seconds = duration(config.timeLimit ?? 0);
  const chosen = { ...configuration({ ...config, seed: typeof config.seed === 'string' && !config.seed.trim() ? null : config.seed }), timeLimit: seconds };
  if (state.score !== 0 && config.confirm !== true) {
    pendingGame = chosen;
    $('#confirm-message').textContent = `Your current score is ${numberFormat.format(state.score)}. Starting a new ${chosen.mode === '2048' ? '2048' : chosen.mode === 'classic' ? 'Classic' : 'Insane'} round replaces this game.`;
    showDialog('#confirm-dialog');
    return { needsConfirmation: true, state: getState() };
  }
  return commitNewGame(chosen);
}

function commitNewGame(chosen) {
  const next = newGame(chosen), seconds = chosen.timeLimit;
  stopCelebration($('#celebration'));
  state = next; past = []; future = []; sessionKey = 'default';
  round = createRound(state, seconds);
  resultDismissed = false; pendingGame = null;
  const clean = new URL(location.href);
  for (const key of gameParameters) clean.searchParams.delete(key);
  clean.hash = '';
  history.replaceState(null, '', clean);
  statusMessage = seconds ? 'Ready. Your first move starts the countdown.' : 'A fresh board. Make your first move.';
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
  form.elements.seed.value = state.seed ?? '';
  form.elements.timeLimit.replaceChildren(...[...new Set([0, 60, 120, 300, preferences.timerDuration, round.durationSeconds])].sort((a, b) => a - b).map(seconds => new Option(seconds ? formatTime(seconds * 1000) : 'Off', seconds)));
  form.elements.timeLimit.value = round.durationSeconds;
  $('#new-error').textContent = '';
  showDialog('#new-dialog');
}

function shareURL(challenge = false) {
  if (refreshDeadline()) render();
  const link = new URL(location.href);
  link.search = ''; link.hash = '';
  if (challenge) {
    if (state.randomness !== 'seeded') throw new Error('Random games have no starting seed. Share a saved-game link instead.');
    link.searchParams.set('seed', state.seed);
    link.searchParams.set('mode', state.mode);
    link.searchParams.set('rows', state.rows);
    link.searchParams.set('cols', state.columns);
    if (round.durationSeconds) link.searchParams.set('timer', round.durationSeconds);
  } else link.hash = 'round=' + encodeRound(state, round);
  return link.href;
}
function openShare(challenge = false) {
  $('#share-url').value = shareURL(challenge);
  $('#share-description').textContent = challenge ? 'Same seed and settings. A fresh board for a friend.'
    : round.expired ? 'This link includes your finished round, board, and result.'
    : round.durationSeconds ? round.startedAt === null ? 'This link keeps your ready board. The first move starts the countdown.' : 'This link keeps your board and the original countdown deadline.'
    : state.randomness === 'seeded' ? 'This link keeps your board, score, elapsed time, and repeatable continuation.'
    : 'This link keeps your board, score, and elapsed time. Future tiles are freshly randomized.';
  $('#share-feedback').textContent = '';
  $('#challenge-button').hidden = challenge || state.randomness !== 'seeded';
  showDialog('#share-dialog');
}

function paintResult(snapshot) {
  const result = snapshot.assessment.result, notice = $('#round-notice');
  notice.hidden = !result || resultDismissed;
  if (!result) { positionResult(); return; }
  for (const [selector, value] of [['#result-max', result.maxTile], ['#result-score', result.score]]) {
    $(selector).textContent = numberFormat.format(value);
    $(selector).style.setProperty('--digits', $(selector).textContent.length);
  }
  positionResult();
}

function positionResult() {
  const notice = $('#round-notice');
  const introElement = $('.intro'), playElement = $('.play-area');
  if (introElement.style.transform) introElement.style.transform = '';
  if (playElement.style.transform) playElement.style.transform = '';
  if (notice.hidden) return;
  let board = $('#board').getBoundingClientRect(), anchor = $('#timer-button').getBoundingClientRect();
  const shell = $('.app-shell').getBoundingClientRect(), style = getComputedStyle($('.app-shell'));
  const left = shell.left + parseFloat(style.paddingLeft), right = shell.right - parseFloat(style.paddingRight);
  const top = parseFloat(style.paddingTop), bottom = innerHeight - parseFloat(style.paddingBottom);
  // Place in the side rail or header, never across the board.
  const side = matchMedia('(orientation:landscape) and (min-width:480px)').matches;
  const preferredWidth = !side && innerWidth <= 420 ? 212 : 280;
  notice.style.width = `${Math.min(preferredWidth, (side ? board.left - 12 : right) - left)}px`;
  const size = notice.getBoundingClientRect();
  let intro = introElement.getBoundingClientRect(), play = playElement.getBoundingClientRect();
  // Use spare space before covering any controls. Only translate; never resize the board.
  if (side && intro.height + size.height + 10 <= bottom - top) {
    const shift = top + (bottom - top - intro.height - size.height - 10) / 2 - intro.top;
    introElement.style.transform = `translateY(${shift}px)`;
  } else if (!side) {
    const shift = Math.max(0, top + size.height + 6 - intro.top);
    if (shift && play.bottom + shift <= bottom) {
      introElement.style.transform = `translateY(${shift}px)`;
      playElement.style.transform = `translateY(${shift}px)`;
    }
  }
  intro = introElement.getBoundingClientRect(); play = playElement.getBoundingClientRect();
  board = $('#board').getBoundingClientRect(); anchor = $('#timer-button').getBoundingClientRect();
  const region = side ? { left, right: board.left - 12, top, bottom }
    : { left, right, top, bottom: board.top - 8 };
  const freeRegions = side
    ? [{ ...region, top: intro.bottom + 10 }, { ...region, bottom: intro.top - 10 }]
    : [{ left, right, top, bottom: intro.top - 6 }, { left, right, top: play.bottom + 6, bottom }];
  const available = freeRegions.filter(area => area.bottom - area.top >= size.height - .1);
  available.sort((a, b) => Math.abs(a.top - anchor.bottom) - Math.abs(b.top - anchor.bottom));
  const placement = available[0] ?? region;
  const x = Math.max(placement.left, Math.min(anchor.left, placement.right - size.width));
  const y = Math.max(placement.top, Math.min(anchor.bottom + 6, placement.bottom - size.height));
  notice.style.left = `${x}px`; notice.style.top = `${y}px`;
}

function openTimer() {
  const current = getState(), seconds = round.durationSeconds || preferences.timerDuration;
  $('#timer-form').elements.minutes.value = Math.floor(seconds / 60);
  $('#timer-form').elements.seconds.value = seconds % 60;
  $('#timer-error').textContent = '';
  $('#timer-result').hidden = !current.assessment.result;
  $('#timer-result-text').textContent = current.assessment.result
    ? `Max tile ${numberFormat.format(round.maxTile)} · Score ${numberFormat.format(state.score)} · ${round.movesMade} moves` : '';
  $('#untimed-button').textContent = round.durationSeconds ? 'Start an untimed round' : 'Keep timer off';
  showDialog('#timer-dialog');
}

function selectedDuration() {
  const form = $('#timer-form'), minutes = Number(form.elements.minutes.value), seconds = Number(form.elements.seconds.value);
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || minutes < 0 || minutes > 60 || seconds < 0 || seconds > 59) throw new Error('Enter whole minutes and seconds.');
  const total = duration(minutes * 60 + seconds);
  if (!total) throw new Error('Choose at least 1 second.');
  return total;
}

function finishNewGameRequest(result) {
  if (result.needsConfirmation) return;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('#board').focus({ preventScroll: true });
}

$('#timer-button').addEventListener('click', openTimer);
$('#dismiss-result').addEventListener('click', () => { resultDismissed = true; $('#round-notice').hidden = true; positionResult(); $('#timer-button').focus({ preventScroll: true }); });
document.querySelectorAll('[data-duration]').forEach(button => button.addEventListener('click', () => {
  $('#timer-form').elements.minutes.value = Number(button.dataset.duration) / 60;
  $('#timer-form').elements.seconds.value = 0;
}));
$('#timer-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const seconds = selectedDuration(); preferences.timerDuration = seconds;
    finishNewGameRequest(startGame({ mode: state.mode, rows: state.rows, columns: state.columns, seed: state.seed, timeLimit: seconds }));
  } catch (error) { $('#timer-error').textContent = error.message; }
});
$('#untimed-button').addEventListener('click', () => {
  if (!round.durationSeconds) {
    try { preferences.timerDuration = selectedDuration(); } catch { /* Keep the previous preset. */ }
    $('#timer-dialog').close(); persist(); return;
  }
  finishNewGameRequest(startGame({ mode: state.mode, rows: state.rows, columns: state.columns, seed: state.seed, timeLimit: 0 }));
});
$('#confirm-start').addEventListener('click', () => {
  if (pendingGame) finishNewGameRequest(commitNewGame(pendingGame));
});
$('#confirm-cancel').addEventListener('click', () => { pendingGame = null; $('#confirm-dialog').close(); });
$('#confirm-dialog').addEventListener('cancel', () => { pendingGame = null; });

$('#help-button').addEventListener('click', () => showDialog('#help-dialog'));
$('#settings-button').addEventListener('click', () => showDialog('#settings-dialog'));
$('#about-button').addEventListener('click', () => showDialog('#about-dialog'));
$('#title-button').addEventListener('click', () => showDialog('#about-dialog'));
$('#settings-about').addEventListener('click', () => showDialog('#about-dialog'));
$('#new-button').addEventListener('click', openNew);
$('#mode-pill').addEventListener('click', openNew);
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
$('#controls-button').addEventListener('click', () => { preferences.controls = !preferences.controls; preferences.controlsChosen = true; render(); });
for (const [selector, property] of [['#controls-setting', 'controls'], ['#display-setting', 'display'], ['#motion-setting', 'motion'], ['#theme-setting', 'theme'], ['#sound-setting', 'sound']]) {
  $(selector).addEventListener('change', event => {
    preferences[property] = ['theme', 'display'].includes(property) ? event.target.value : event.target.checked;
    if (property === 'controls') preferences.controlsChosen = true;
    preferences.bits = preferences.display !== 'numbers';
    const clean = new URL(location.href);
    clean.searchParams.delete(property);
    if (property === 'display') clean.searchParams.delete('bits');
    history.replaceState(null, '', clean);
    render();
    if (property === 'sound' && preferences.sound) playSound(3);
  });
}
$('#volume-setting').addEventListener('input', event => {
  preferences.volume = Number(event.target.value) / 100;
  const clean = new URL(location.href); clean.searchParams.delete('volume'); history.replaceState(null, '', clean);
  render();
});
$('#volume-setting').addEventListener('change', () => playSound(3));
$('#daily-button').addEventListener('click', () => {
  $('#new-form').elements.seed.value = `daily-${new Date().toISOString().slice(0, 10)}`;
  $('#new-form').elements.mode.value = 'classic';
  $('#new-form').elements.rows.value = 4; $('#new-form').elements.columns.value = 4;
});
$('#new-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    finishNewGameRequest(startGame({ mode: form.elements.mode.value, rows: Number(form.elements.rows.value), columns: Number(form.elements.columns.value), seed: form.elements.seed.value, timeLimit: Number(form.elements.timeLimit.value) }));
  } catch (error) { $('#new-error').textContent = error.message; }
});

document.addEventListener('keydown', event => {
  $('#board').classList.remove('pointer-focus');
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  const key = event.key.toLowerCase(), direction = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', w: 'up', a: 'left', s: 'down', d: 'right' }[key];
  if (direction) { event.preventDefault(); void unlockAudio(); performMove(direction); }
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
  void unlockAudio();
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
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(clockTask); flushSave(); stopCelebration($('#celebration')); }
  else { if (refreshDeadline()) render(); else { paintTimer(snapshotState()); scheduleClock(); } }
});
window.addEventListener('pageshow', () => { if (refreshDeadline()) render(); else scheduleClock(); });
window.addEventListener('pagehide', () => { refreshDeadline(); persist(); flushSave(); clearTimeout(clockTask); stopCelebration($('#celebration')); });
reducedMotion.addEventListener('change', event => { if (event.matches) stopCelebration($('#celebration')); });
document.addEventListener('pointerdown', () => { void unlockAudio(); }, { passive: true });

const api = Object.freeze({
  version: 3, getState,
  move(direction) {
    if (roundLocked()) return { changed: false, gain: 0, reason: 'timeout', state: snapshotState() };
    if (document.querySelector('dialog[open]')) throw new Error('Close the open dialog before moving.');
    return performMove(direction);
  },
  newGame(config) { const result = startGame(config); if (!result.needsConfirmation) document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); return result; }, undo, redo,
  shareURL(options = {}) { return shareURL(options.challenge === true); }
});
Object.defineProperty(window, 'game2047', { value: api, writable: false, configurable: false });
render();

const registry = document.modelContext ?? navigator.modelContext;
if (typeof registry?.registerTool === 'function') {
  const definitions = [
    { name: 'game2047_get_state', description: 'Read the 2047 board, score, legal moves, and undo availability.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => api.getState() },
    { name: 'game2047_move', description: 'Slide the 2047 board one step. Returns the updated board after any merge and spawn.', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: DIRECTIONS } }, required: ['direction'], additionalProperties: false }, execute: input => api.move(input?.direction) },
    { name: 'game2047_new_game', description: 'Start a new round, optionally timed. Nonzero scores require explicit confirmation; pass confirm true to confirm replacement.', inputSchema: { type: 'object', properties: { seed: { type: 'string', maxLength: 128 }, mode: { type: 'string', enum: MODES }, rows: { type: 'integer', minimum: 2, maximum: 8 }, columns: { type: 'integer', minimum: 2, maximum: 8 }, timeLimit: { type: 'integer', minimum: 0, maximum: 3600 }, confirm: { type: 'boolean' } }, additionalProperties: false }, execute: input => api.newGame(input) },
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
