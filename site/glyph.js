// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
export function bitGlyph(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('A bit glyph requires a positive integer.');
  const binary = value.toString(2);
  const side = Math.max(2, Math.ceil(Math.sqrt(binary.length)));
  return { side, binary, cells: [...Array(side * side - binary.length).fill('hidden'), ...Array.from(binary, bit => bit === '1' ? 'one' : 'zero')] };
}
