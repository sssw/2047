// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { MAX_TILE, validateState, encodeState, decodeState } from './engine.js?v=20261014-random2';

export const DEFAULT_DURATION = 120;
export const MILESTONE = 2047;

export function duration(value = 0) {
  if (!Number.isInteger(value) || value < 0 || value > 3600) throw new Error('Choose a time limit from 1 second to 60 minutes, or 0 for off.');
  return value;
}

export function createClock(wall = Date.now, monotonic = () => performance.now()) {
  const start = wall(), offset = monotonic();
  let last = start;
  return () => (last = Math.max(last, wall(), start + monotonic() - offset));
}

export function createRound(game, seconds = 0, now = Date.now()) {
  const durationSeconds = duration(seconds), maxTile = Math.max(...game.grid);
  const startedAt = durationSeconds ? Math.floor(now) : null;
  return { version: 1, durationSeconds, startedAt, deadline: startedAt === null ? null : startedAt + durationSeconds * 1000,
    expired: false, maxTile, celebrated: maxTile >= MILESTONE, startScore: game.score, movesMade: 0, undos: 0, redos: 0 };
}

export function remaining(round, now) {
  return round.durationSeconds ? Math.max(0, Math.min(round.durationSeconds * 1000, round.deadline - now)) : null;
}

export function expireRound(round, now) {
  return !round.expired && round.durationSeconds && now >= round.deadline ? { ...round, expired: true } : round;
}

export function recordRound(round, game, action) {
  if (round.expired) return { round, milestone: false };
  const maxTile = Math.max(round.maxTile, ...game.grid);
  const milestone = !round.celebrated && maxTile >= MILESTONE;
  return { round: { ...round, maxTile, celebrated: round.celebrated || milestone,
    movesMade: round.movesMade + (action === 'move' ? 1 : 0), undos: round.undos + (action === 'undo' ? 1 : 0), redos: round.redos + (action === 'redo' ? 1 : 0) }, milestone };
}

export function assessment(round, game, now) {
  return {
    enabled: round.durationSeconds > 0, status: round.expired ? 'finished' : round.durationSeconds ? 'running' : 'off',
    durationSeconds: round.durationSeconds, remainingMs: round.expired ? 0 : remaining(round, now) === null ? null : Math.ceil(remaining(round, now)),
    startedAt: round.startedAt, deadline: round.deadline,
    result: round.expired ? {
      reason: 'timeout', maxTile: round.maxTile, score: game.score, scoreGain: game.score - round.startScore,
      moves: game.moves, movesMade: round.movesMade, undos: round.undos, redos: round.redos,
      durationSeconds: round.durationSeconds, endedAt: round.deadline,
      mode: game.mode, rows: game.rows, columns: game.columns, randomness: game.randomness, seed: game.seed
    } : null
  };
}

export function formatTime(milliseconds) {
  const total = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function validateRound(value, game) {
  if (value === undefined || value === null) return createRound(game);
  if (value.version !== 1) throw new Error('Unsupported timed round.');
  const seconds = duration(value.durationSeconds);
  const validInteger = (number, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(number) && number >= 0 && number <= max;
  if (seconds ? !validInteger(value.startedAt) || !validInteger(value.deadline) || value.deadline !== value.startedAt + seconds * 1000
    : value.startedAt !== null || value.deadline !== null || value.expired !== false) throw new Error('Invalid countdown.');
  if (typeof value.expired !== 'boolean' || typeof value.celebrated !== 'boolean'
    || !validInteger(value.maxTile, MAX_TILE) || value.maxTile < Math.max(...game.grid)
    || value.celebrated !== (value.maxTile >= MILESTONE)
    || !['startScore', 'movesMade', 'undos', 'redos'].every(key => validInteger(value[key]))) throw new Error('Invalid round record.');
  return { version: 1, durationSeconds: seconds, startedAt: value.startedAt, deadline: value.deadline, expired: value.expired,
    maxTile: value.maxTile, celebrated: value.celebrated, startScore: value.startScore, movesMade: value.movesMade, undos: value.undos, redos: value.redos };
}

export function encodeRound(game, round) {
  const text = JSON.stringify({ version: 1, game: encodeState(game), round: validateRound(round, game) });
  return btoa(String.fromCharCode(...new TextEncoder().encode(text))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeRound(text) {
  if (typeof text !== 'string' || text.length > 16000 || !/^[\w-]+$/.test(text)) throw new Error('Invalid round link.');
  try {
    const bytes = Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (value.version !== 1 || !value.round || typeof value.round !== 'object') throw new Error();
    const game = validateState(decodeState(value.game));
    return { game, round: validateRound(value.round, game) };
  } catch { throw new Error('Invalid round link.'); }
}
