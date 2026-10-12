import { describe, it, expect } from 'vitest';
import { computeLineDiff } from './sourceDiff';

describe('computeLineDiff', () => {
  it('returns empty when codes are identical', () => {
    const code = 'sequenceDiagram\n    participant A\n    participant B';
    const result = computeLineDiff(code, code);
    expect(result.changedLines).toEqual([]);
    expect(result.firstChangedLine).toBeNull();
  });

  it('detects a single modified line', () => {
    const oldCode = 'sequenceDiagram\n    participant A\n    A->>B: Hello\n    B-->>A: Hi';
    const newCode = 'sequenceDiagram\n    participant A\n    A->>B: Good morning\n    B-->>A: Hi';
    const result = computeLineDiff(oldCode, newCode);
    expect(result.changedLines).toEqual([3]);
    expect(result.firstChangedLine).toBe(3);
  });

  it('detects added lines at the end', () => {
    const oldCode = 'sequenceDiagram\n    participant A';
    const newCode = 'sequenceDiagram\n    participant A\n    participant B\n    A->>B: Call';
    const result = computeLineDiff(oldCode, newCode);
    expect(result.changedLines).toEqual([3, 4]);
    expect(result.firstChangedLine).toBe(3);
  });

  it('detects inserted lines in the middle', () => {
    const oldCode = 'line 1\nline 2\nline 5';
    const newCode = 'line 1\nline 2\nline 3\nline 4\nline 5';
    const result = computeLineDiff(oldCode, newCode);
    expect(result.changedLines).toEqual([3, 4]);
    expect(result.firstChangedLine).toBe(3);
  });

  it('detects deleted lines by anchoring to the deletion site', () => {
    const oldCode = 'line 1\nline 2\nline 3\nline 4';
    const newCode = 'line 1\nline 2\nline 4';
    const result = computeLineDiff(oldCode, newCode);
    expect(result.changedLines).toEqual([3]);
    expect(result.firstChangedLine).toBe(3);
  });

  it('handles reordered participants/lines', () => {
    const oldCode = 'sequenceDiagram\n    participant A\n    participant B\n    participant C';
    const newCode = 'sequenceDiagram\n    participant B\n    participant A\n    participant C';
    const result = computeLineDiff(oldCode, newCode);
    // B was moved before A (or A moved after B)
    expect(result.changedLines.length).toBeGreaterThan(0);
    expect(result.changedLines.every(l => l >= 2 && l <= 3)).toBe(true);
  });

  it('handles completely different code', () => {
    const oldCode = 'A\nB\nC';
    const newCode = 'X\nY\nZ';
    const result = computeLineDiff(oldCode, newCode);
    expect(result.changedLines).toEqual([1, 2, 3]);
    expect(result.firstChangedLine).toBe(1);
  });
});
