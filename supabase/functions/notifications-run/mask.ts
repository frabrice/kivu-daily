// Swap people's names, phone numbers and plates for codes before text
// goes to an AI provider, and swap them back afterwards. No imports, so it
// can be tested on its own.

const letters = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : letters(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Mask { hide: (s: string) => string; show: (s: string) => string }

export function buildMask(names: { name: string; kind: string }[]): Mask {
  const codeOf = new Map<string, string>(); // lower-case original -> code
  const back = new Map<string, string>(); // code -> original
  let n = 0;
  const code = (original: string, kind: string, k = original.toLowerCase()) => {
    if (!codeOf.has(k)) { const c = `${kind} ${letters(n++)}`; codeOf.set(k, c); back.set(c, original); }
    return codeOf.get(k)!;
  };
  // Full names first (longest first), then each single name part of 3+ letters.
  const pieces: { text: string; kind: string }[] = [];
  for (const x of names) {
    const full = x.name.trim().replace(/\s+/g, " ");
    pieces.push({ text: full, kind: x.kind });
    for (const part of full.split(" ")) if (part.length >= 3) pieces.push({ text: part, kind: x.kind });
  }
  pieces.sort((a, b) => b.text.length - a.text.length);
  const seen = new Set<string>();
  const patterns = pieces.filter((p) => !seen.has(p.text.toLowerCase()) && seen.add(p.text.toLowerCase()))
    .map((p) => ({ re: new RegExp(`(?<![\\p{L}])${escapeRe(p.text)}(?![\\p{L}])`, "giu"), p }));

  return {
    hide: (s: string) => {
      let out = s.replace(/\+?250\s?7\d{2}\s?\d{3}\s?\d{3}|\b07\d{8}\b/g, "[phone]");
      out = out.replace(/\bR[A-Z]{2}\s?\d{3}\s?[A-Z]\b/g, (plate) => code(plate, "Car", plate.replace(/\s/g, "").toLowerCase()));
      for (const { re, p } of patterns) out = out.replace(re, (m) => code(m, p.kind));
      return out;
    },
    show: (s: string) => [...back.entries()].sort((a, b) => b[0].length - a[0].length).reduce((acc, [c, original]) => acc.split(c).join(original), s),
  };
}
