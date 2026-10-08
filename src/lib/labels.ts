export type Priority = 1 | 2 | 3 | null;

const CANONICAL = /^\[P([123])\]$/i;
const WORD: Record<string, 1 | 2 | 3> = { high: 1, medium: 2, low: 3 };

const firstLine = (notes?: string) => (notes ?? '').split('\n')[0].trim();

/**
 * The widget's own `[Pn]` first notes line wins outright. Otherwise accept the loose forms
 * Gemini tends to write, in the title or first notes line; the highest priority found wins.
 * Bare words like "urgent" or "high" are deliberately ignored.
 */
export function parsePriority(title?: string, notes?: string): Priority {
  const canon = firstLine(notes).match(CANONICAL);
  if (canon) return Number(canon[1]) as 1 | 2 | 3;

  const text = `${title ?? ''}\n${firstLine(notes)}`;
  const found = [
    ...[...text.matchAll(/\bp([123])\b/gi)].map((m) => Number(m[1])),
    ...[...text.matchAll(/\bpriority\s*:\s*(high|medium|low)\b/gi)].map((m) => WORD[m[1].toLowerCase()]),
    ...[...text.matchAll(/\b(high|medium|low)\s+priority\b/gi)].map((m) => WORD[m[1].toLowerCase()]),
  ];
  return found.length ? (Math.min(...found) as 1 | 2 | 3) : null;
}

export function writePriority(notes: string | undefined, p: Priority): string {
  const lines = (notes ?? '').split('\n');
  if (CANONICAL.test(lines[0].trim())) lines.shift();
  const body = lines.join('\n');
  if (!p) return body;
  return body ? `[P${p}]\n${body}` : `[P${p}]`;
}

export function stripPriority(notes?: string): string {
  return writePriority(notes, null);
}

export function nextPriority(p: Priority): Priority {
  return p === null ? 1 : p === 3 ? null : ((p + 1) as 2 | 3);
}
