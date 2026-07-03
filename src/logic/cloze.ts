export interface ClozeSegment {
  type: 'text' | 'blank';
  value: string;
}

/** Split cloze text on {{answer}} markers. Blanks carry the answer text. */
export function parseCloze(text: string): ClozeSegment[] {
  const segments: ClozeSegment[] = [];
  const re = /\{\{(.+?)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', value: text.slice(last, m.index) });
    segments.push({ type: 'blank', value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) });
  return segments;
}
