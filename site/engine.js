// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { hashText, secureIndex, seededIndex } from './random.js?v=20261014-random2';
export const DIRECTIONS = Object.freeze(['up', 'right', 'down', 'left']);
export const MODES = Object.freeze(['classic', 'insane', '2048']);
export const MAX_TILE = 2 ** 48 - 1;
const MASK = (1n << 64n) - 1n;

export function hashSeed(text) {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(text)) hash = ((hash ^ BigInt(byte)) * 1099511628211n) & MASK;
  return hash || 0xB17F51A1DEADBEEFn;
}

export function nextRandom(state, upperBound) {
  const bound = BigInt(upperBound);
  const threshold = ((1n << 64n) - bound) % bound;
  let current = BigInt(state);
  for (;;) {
    current = (current + 0x9E3779B97F4A7C15n) & MASK;
    let z = current;
    z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & MASK;
    z ^= z >> 31n;
    if (z >= threshold) return { state: current.toString(), index: Number(z % bound) };
  }
}

function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}.`);
  return value;
}

export function configuration(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid game configuration.');
  const rows = integer(input.rows ?? input.size ?? 4, 2, 8, 'rows (2–8)');
  const columns = integer(input.columns ?? input.size ?? 4, 2, 8, 'columns (2–8)');
  const mode = input.mode ?? 'classic';
  if (!MODES.includes(mode)) throw new Error('Invalid mode.');
  const seed = input.seed ?? null;
  if (seed !== null && (typeof seed !== 'string' || seed.trim().length > 128 || !seed.trim().length)) throw new Error('Seed must contain 1–128 characters.');
  return { rows, columns, mode, seed: seed === null ? null : seed.trim() };
}

export function allOnes(value) {
  return value > 0 && (BigInt(value) & (BigInt(value) + 1n)) === 0n;
}

export function canMerge(a, b, mode = 'classic') {
  if (!a || !b) return false;
  const compatible = mode === '2048' ? a === b : (BigInt(a) & BigInt(b)) === 0n || (a === b && allOnes(a));
  return compatible && mergedValue(a, b, mode) <= MAX_TILE;
}

export function mergedValue(a, b, mode) {
  return mode === 'insane' && a === b && allOnes(a) ? a + 1 : a + b;
}

export function mergeLine(line, mode = 'classic') {
  const compact = line.filter(Boolean);
  const values = [], merged = [];
  let gain = 0;
  for (let i = 0; i < compact.length; i++) {
    if (i + 1 < compact.length && canMerge(compact[i], compact[i + 1], mode)) {
      const value = mergedValue(compact[i], compact[++i], mode);
      merged.push(values.length);
      values.push(value);
      gain += value;
    } else values.push(compact[i]);
  }
  while (values.length < line.length) values.push(0);
  return { values, gain, merged };
}

export function slide(state, direction) {
  if (!DIRECTIONS.includes(direction)) throw new Error('Direction must be up, right, down, or left.');
  const grid = [...state.grid], merged = [];
  let gain = 0;
  const horizontal = direction === 'left' || direction === 'right';
  const lineCount = horizontal ? state.rows : state.columns;
  const lineSize = horizontal ? state.columns : state.rows;
  for (let line = 0; line < lineCount; line++) {
    const indices = Array.from({ length: lineSize }, (_, n) => horizontal ? line * state.columns + n : n * state.columns + line);
    if (direction === 'right' || direction === 'down') indices.reverse();
    const result = mergeLine(indices.map(index => grid[index]), state.mode);
    result.values.forEach((value, n) => { grid[indices[n]] = value; });
    merged.push(...result.merged.map(n => indices[n]));
    gain += result.gain;
  }
  return { grid, gain, merged, changed: grid.some((value, i) => value !== state.grid[i]) };
}

export function legalMoves(state) {
  return DIRECTIONS.filter(direction => slide(state, direction).changed);
}

function spawn(state, direction = 'initial') {
  const empty = state.grid.flatMap((value, i) => value === 0 ? [i] : []);
  if (!empty.length) return state;
  const random = state.version === 1 ? nextRandom(state.rng, empty.length)
    : state.randomness === 'seeded' ? seededIndex(state, direction, empty.length)
    : { index: secureIndex(empty.length), state: null };
  const index = empty[random.index];
  state.grid[index] = state.mode === '2048' ? 2 : 1;
  state.rng = random.state;
  state.lastSpawn = index;
  return state;
}

export function newGame(input) {
  const config = configuration(input);
  const randomness = config.seed === null ? 'random' : 'seeded';
  const state = { version: 2, ...config, randomness, grid: Array(config.rows * config.columns).fill(0), score: 0, moves: 0,
    rng: randomness === 'seeded' ? hashText(JSON.stringify(['2047/seed/v2', config.seed])) : null, lastSpawn: null };
  return spawn(spawn(state));
}

export function move(state, direction) {
  return advance(state, direction, false);
}

function advance(state, direction, legacy) {
  const result = slide(state, direction);
  if (!result.changed) return { state, changed: false, gain: 0, merged: [] };
  if (!Number.isSafeInteger(state.score + result.gain)) throw new Error('The score limit has been reached.');
  const base = state.version === 1 && !legacy ? validateState(state) : state;
  const next = spawn({ ...base, grid: result.grid, score: state.score + result.gain, moves: state.moves + 1 }, direction);
  return { state: next, changed: true, gain: result.gain, merged: result.merged };
}

export function validateState(value) {
  return validateSaved(value, false);
}

function validateSaved(value, preserveLegacy) {
  if (!value || ![1, 2].includes(value.version)) throw new Error('Unsupported saved game.');
  const config = configuration(value);
  if (!Array.isArray(value.grid) || value.grid.length !== config.rows * config.columns) throw new Error('Board size does not match.');
  const grid = value.grid.map(tile => integer(tile, 0, MAX_TILE, 'tile'));
  if (!grid.some(Boolean)) throw new Error('The board must contain a tile.');
  if (config.mode === '2048' && grid.some(tile => tile && (tile < 2 || (BigInt(tile) & (BigInt(tile) - 1n)) !== 0n))) throw new Error('2048 tiles must be powers of two.');
  const score = integer(value.score, 0, Number.MAX_SAFE_INTEGER, 'score');
  const moves = integer(value.moves, 0, Number.MAX_SAFE_INTEGER - 1, 'move count');
  const lastSpawn = value.lastSpawn === null || value.lastSpawn === undefined ? null : integer(value.lastSpawn, 0, grid.length - 1, 'spawn index');
  if (value.version === 1) {
    if (!config.seed || typeof value.rng !== 'string' || !/^\d{1,20}$/.test(value.rng) || BigInt(value.rng) > MASK) throw new Error('Invalid random state.');
    if (preserveLegacy) return { version: 1, ...config, grid, score, moves, rng: value.rng, lastSpawn };
    // Version 1 used a seed for every game. Preserve that provenance when upgrading.
    return { version: 2, ...config, randomness: 'seeded', grid, score, moves,
      rng: hashText(JSON.stringify(['2047/upgrade/v2', config.seed, value.rng])), lastSpawn };
  }
  const randomness = config.seed === null ? 'random' : 'seeded';
  if (value.randomness !== randomness || (randomness === 'random' ? value.rng !== null : typeof value.rng !== 'string' || !/^[0-9a-f]{64}$/.test(value.rng))) throw new Error('Invalid random state.');
  return { version: 2, ...config, randomness, grid, score, moves, rng: value.rng, lastSpawn };
}

export function encodeState(state) {
  return encodeJSON(validateState(state));
}

function encodeJSON(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeState(text) {
  return decodeSaved(text, false);
}

function decodeSaved(text, preserveLegacy) {
  if (typeof text !== 'string' || text.length > 6000 || !/^[\w-]+$/.test(text)) throw new Error('Invalid saved-game link.');
  try {
    const bytes = Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    return validateSaved(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), preserveLegacy);
  } catch { throw new Error('Invalid saved-game link.'); }
}

export function launchFromURL(url) {
  return launch(url, false);
}

// Locate pre-upgrade URL saves without changing their boards or undo histories.
export function legacySessionKey(url) {
  const state = launch(url, true);
  return state ? 'link-' + hashSeed(encodeJSON(state)).toString(16) : null;
}

function launch(url, legacy) {
  const params = url.searchParams;
  if (url.hash.startsWith('#state=')) return decodeSaved(url.hash.slice(7), legacy);
  const hasGame = ['seed', 'mode', 'size', 'rows', 'cols', 'moves', 'board', 'score'].some(key => params.has(key));
  if (!hasGame) return null;
  const config = { seed: params.get('seed') ?? (legacy ? '2047' : null), mode: params.get('mode') ?? 'classic' };
  for (const [key, name] of [['size', 'size'], ['rows', 'rows'], ['cols', 'columns']]) if (params.has(key)) config[name] = Number(params.get(key));
  const normalized = configuration(config);
  let state = legacy ? spawn(spawn({ version: 1, ...normalized, grid: Array(normalized.rows * normalized.columns).fill(0), score: 0, moves: 0, rng: hashSeed(normalized.seed).toString(), lastSpawn: null })) : newGame(config);
  if (params.has('board')) {
    const entries = params.get('board').split(',');
    if (entries.some(x => !/^\d+$/.test(x))) throw new Error('Board must contain comma-separated numbers.');
    state = validateSaved({ ...state, grid: entries.map(Number), score: params.has('score') ? Number(params.get('score')) : 0, lastSpawn: null }, legacy);
  } else if (params.has('score')) throw new Error('A score requires a board.');
  const steps = params.get('moves') ?? '';
  if (steps.length > 1000 || !/^[UDLR]*$/i.test(steps)) throw new Error('Moves must be up to 1,000 U, D, L, or R letters.');
  const map = { U: 'up', D: 'down', L: 'left', R: 'right' };
  for (const letter of steps.toUpperCase()) state = advance(state, map[letter], legacy).state;
  return state;
}
