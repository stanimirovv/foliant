// Render-level verification for note tags: tagging a note and hiding its key
// must remove it from the rendered diagram (create -> change -> verify,
// EDITING_PLAN.md 4.13). The whole pipeline — CONFIG -> transformActors ->
// mermaid — is exercised, mirroring arrowTags.integration.test.ts.

import { describe, it, expect } from 'vitest';
import { renderPipeline, parseConfig } from './editorTestHarness';
import { addTag, removeTag, getNoteTags } from './editor';
import { buildSelectionMap } from './svgmap';

const SEQ = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    participant C as Carol
    A->>B: Hello
    Note over A,B: Retry policy
    Note over C: Untagged note
    B-->>C: Done`;

describe('note tags (rendered)', () => {
  it('hiding a note key removes the note from the rendered diagram', async () => {
    const tagged = addTag(SEQ, null, 'note:0', 'flaky'); // Note over A,B: Retry policy
    expect(tagged.warning).toBeUndefined();

    const before = await renderPipeline(tagged.code);
    expect(before.model.elements.filter(e => e.kind === 'note')).toHaveLength(2);
    expect(before.svg).toContain('Retry policy');

    const after = await renderPipeline(tagged.code, { hideKeys: ['flaky'] });
    const notes = after.model.elements.filter(e => e.kind === 'note');
    expect(notes.map(n => n.text)).toEqual(['Untagged note']);
    expect(after.svg).not.toContain('Retry policy');
    // the untagged note and the messages survive
    expect(after.svg).toContain('Untagged note');
    expect(after.svg).toContain('Hello');
    expect(after.svg).toContain('Done');
  });

  it('a note with multiple tags is hidden only when all tags are disabled', async () => {
    const t1 = addTag(SEQ, null, 'note:0', 'flaky');
    const t2 = addTag(t1.code, t1.config, 'note:0', 'beta');
    expect(t2.warning).toBeUndefined();

    // Hiding only one tag: the note remains rendered
    const oneHidden = await renderPipeline(t2.code, { hideKeys: ['flaky'] });
    expect(oneHidden.model.elements.filter(e => e.kind === 'note')).toHaveLength(2);
    expect(oneHidden.svg).toContain('Retry policy');

    // Hiding all tags: the note is removed from the rendered diagram
    const allHidden = await renderPipeline(t2.code, { hideKeys: ['flaky', 'beta'] });
    expect(allHidden.model.elements.filter(e => e.kind === 'note')).toHaveLength(1);
    expect(allHidden.svg).not.toContain('Retry policy');
  });

  it('an untagged note is unaffected by unrelated hidden keys', async () => {
    const tagged = addTag(SEQ, null, 'note:0', 'flaky');
    const after = await renderPipeline(tagged.code, { hideKeys: ['unrelated'] });
    expect(after.model.elements.filter(e => e.kind === 'note')).toHaveLength(2);
    expect(after.svg).toContain('Retry policy');
    expect(after.svg).toContain('Untagged note');
  });

  it('hiding an actor still drops the notes over it (pre-existing rule)', async () => {
    const code = `%% CONFIG: {"version":1,"actors":{"C":{"keys":["edge-case"]}}}
sequenceDiagram
    participant A as Alice
    participant C as Carol
    A->>C: Hello
    Note over A,C: Cross note
    Note over A: Safe note`;
    const after = await renderPipeline(code, { hideKeys: ['edge-case'] });
    const notes = after.model.elements.filter(e => e.kind === 'note');
    expect(notes.map(n => n.text)).toEqual(['Safe note']);
  });

  it('a tag-hidden note is not selectable; un-hiding restores it', async () => {
    const tagged = addTag(SEQ, null, 'note:0', 'flaky');
    const cfg = parseConfig(tagged.code)!;

    const visible = await renderPipeline(tagged.code);
    const visibleMap = buildSelectionMap(tagged.code, visible.processedCode, cfg, {});
    const visibleNote = Array.from(visibleMap.entries()).find(([, el]) => el.kind === 'note');
    expect(visibleNote).toBeDefined();

    const hidden = await renderPipeline(tagged.code, { hideKeys: ['flaky'] });
    const hiddenMap = buildSelectionMap(tagged.code, hidden.processedCode, cfg, { hideKeys: ['flaky'] });
    const hiddenNotes = Array.from(hiddenMap.values()).filter(el => el.kind === 'note');
    expect(hiddenNotes.map(n => (n as { text: string }).text)).toEqual(['Untagged note']);
  });

  it('removing the last tag un-hides the note and prunes the entry', async () => {
    const t1 = addTag(SEQ, null, 'note:0', 'flaky');
    const t2 = removeTag(t1.code, t1.config!, 'note:0', 'flaky');
    expect(t2.config?.noteTags).toBeUndefined();
    const after = await renderPipeline(t2.code, { hideKeys: ['flaky'] });
    expect(after.model.elements.filter(e => e.kind === 'note')).toHaveLength(2);
    expect(after.svg).toContain('Retry policy');
    expect(getNoteTags(t2.code, t2.config, 'note:0')).toEqual([]);
  });
});
