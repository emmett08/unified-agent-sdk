export interface DiffFile {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: Array<{ kind: 'context' | 'add' | 'del'; text: string }>;
  header?: string;
}

const HUNK_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@\s*(.*)$/;

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const lines = diff.replace(/\r\n/g, '\n').split('\n');
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let i = 0;

  const normPath = (p: string) => p.replace(/^a\//, '').replace(/^b\//, '').trim();

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('diff --git ')) {
      const parts = line.split(' ');
      const a = parts[2] ?? '';
      const b = parts[3] ?? '';
      cur = { oldPath: normPath(a), newPath: normPath(b), hunks: [] };
      files.push(cur);
      i++;
      continue;
    }
    if (line.startsWith('--- ') && cur) {
      cur.oldPath = normPath(line.slice(4));
      i++;
      continue;
    }
    if (line.startsWith('+++ ') && cur) {
      cur.newPath = normPath(line.slice(4));
      i++;
      continue;
    }
    const m = HUNK_RE.exec(line);
    if (m && cur) {
      const oldStart = parseInt(m[1]!, 10);
      const oldLines = m[2] ? parseInt(m[2], 10) : 1;
      const newStart = parseInt(m[3]!, 10);
      const newLines = m[4] ? parseInt(m[4], 10) : 1;
      const header = m[5] || '';
      const hunk: DiffHunk = { oldStart, oldLines, newStart, newLines, lines: [], header };
      i++;
      while (i < lines.length) {
        const l = lines[i] ?? '';
        if (l.startsWith('diff --git ') || HUNK_RE.test(l) || l.startsWith('--- ') || l.startsWith('+++ ')) break;
        if (l.startsWith('+')) hunk.lines.push({ kind: 'add', text: l.slice(1) });
        else if (l.startsWith('-')) hunk.lines.push({ kind: 'del', text: l.slice(1) });
        else if (l.startsWith(' ')) hunk.lines.push({ kind: 'context', text: l.slice(1) });
        else if (l === '\\ No newline at end of file') {
          // ignore
        } else {
          // Treat unknown as context
          hunk.lines.push({ kind: 'context', text: l });
        }
        i++;
      }
      cur.hunks.push(hunk);
      continue;
    }
    i++;
  }

  return files;
}

/**
 * Applies a unified diff hunk. If the hunk does not match at the expected location,
 * we attempt a small fuzzy match by searching for the first context line.
 */
export function applyHunk(originalText: string, hunk: DiffHunk): { text: string; appliedAtLine: number } {
  const origLines = originalText.replace(/\r\n/g, '\n').split('\n');
  const expectedIdx = Math.max(0, hunk.oldStart - 1);

  const tryApplyAt = (idx: number): { ok: boolean; out?: string[] } => {
    let i = idx;
    const out: string[] = [];
    // copy prefix
    out.push(...origLines.slice(0, idx));

    for (const hl of hunk.lines) {
      if (hl.kind === 'context') {
        if (origLines[i] !== hl.text) return { ok: false };
        out.push(origLines[i]!);
        i++;
      } else if (hl.kind === 'del') {
        if (origLines[i] !== hl.text) return { ok: false };
        i++;
      } else if (hl.kind === 'add') {
        out.push(hl.text);
      }
    }

    // copy suffix
    out.push(...origLines.slice(i));
    return { ok: true, out };
  };

  let attempt = tryApplyAt(expectedIdx);
  if (!attempt.ok) {
    const firstContext = hunk.lines.find((l) => l.kind === 'context')?.text;
    if (firstContext) {
      const found = origLines.findIndex((l, idx) => idx >= 0 && l === firstContext);
      if (found >= 0) attempt = tryApplyAt(found);
    }
  }

  if (!attempt.ok || !attempt.out) {
    throw new Error(`Failed to apply hunk at -${hunk.oldStart} +${hunk.newStart}`);
  }

  return { text: attempt.out.join('\n'), appliedAtLine: expectedIdx };
}
