import { describe, it, expect } from 'vitest';
import { formatRecentDir } from './recentDirs';

// Fixed-width "font": every character measures `px` pixels.
const fixedMeasure = (px: number) => (text: string) => text.length * px;

describe('formatRecentDir', () => {
  it('shows paths with 3 or fewer components in full', () => {
    const measure = fixedMeasure(10);
    expect(formatRecentDir('/a/b', 1000, measure)).toBe('/a/b');
    expect(formatRecentDir('/a/b/c', 1000, measure)).toBe('/a/b/c');
    expect(formatRecentDir('a/b/c', 1000, measure)).toBe('a/b/c');
    expect(formatRecentDir('/', 1000, measure)).toBe('/');
  });

  it('shows the last 3 components when they would be visible', () => {
    // '…/code/proj-a/diagrams' = 22 chars * 10px = 220 <= 300
    expect(formatRecentDir('/Users/me/code/proj-a/diagrams', 300, fixedMeasure(10)))
      .toBe('…/code/proj-a/diagrams');
  });

  it('falls back to the last 2 components when 3 would not be visible', () => {
    // 220 > 200; '…/proj-a/diagrams' = 17 chars * 10px = 170 <= 200
    expect(formatRecentDir('/Users/me/code/proj-a/diagrams', 200, fixedMeasure(10)))
      .toBe('…/proj-a/diagrams');
  });

  it('falls back to the last component when 2 would not be visible', () => {
    // 220 > 150 and 170 > 150; '…/diagrams' = 10 chars * 10px = 100 <= 150
    expect(formatRecentDir('/Users/me/code/proj-a/diagrams', 150, fixedMeasure(10)))
      .toBe('…/diagrams');
  });

  it('shows the bare last component when nothing wider fits', () => {
    // '…/diagrams' = 100 > 90
    expect(formatRecentDir('/Users/me/code/proj-a/diagrams', 90, fixedMeasure(10)))
      .toBe('diagrams');
  });

  it('handles windows-style separators', () => {
    expect(formatRecentDir('C:\\Users\\me\\code\\proj-a\\diagrams', 300, fixedMeasure(10)))
      .toBe('…/code/proj-a/diagrams');
  });

  it('ignores empty segments from leading and trailing slashes', () => {
    expect(formatRecentDir('//Users//me/code/proj-a/diagrams/', 300, fixedMeasure(10)))
      .toBe('…/code/proj-a/diagrams');
  });
});
