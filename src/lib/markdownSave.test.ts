import { describe, it, expect } from 'vitest';
import { runMarkdownSaveJob, MarkdownSaveDeps } from './markdownSave';
import { extractMermaidBlocks } from './markdown';
import { JobError } from './jobQueue';
import { StorageError } from './storage/types';

const MD = `# Doc

Intro.

\`\`\`mermaid
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: First
\`\`\`

Middle.

\`\`\`mermaid
%% CONFIG: {"version":1,"actors":{"A":{"color":"#e11d48"}}}
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Second
\`\`\`

Outro.
`;

const makeDeps = (initial: string) => {
  const state = { content: initial, version: 0, writes: [] as string[] };
  const deps: MarkdownSaveDeps = {
    readFileVersion: async () => ({ content: state.content, version: `v${state.version}` }),
    writeFile: async (_path, content, opts) => {
      if (opts?.ifMatchVersion !== undefined && opts.ifMatchVersion !== `v${state.version}`) {
        throw new StorageError('conflict', 'version mismatch (stale ifMatchVersion)');
      }
      state.writes.push(content);
      state.content = content;
      state.version += 1;
    },
  };
  return { state, deps };
};

describe('runMarkdownSaveJob', () => {
  it('writes the updated markdown with only the target block changed', async () => {
    const { state, deps } = makeDeps(MD);
    const original = extractMermaidBlocks(MD)[1].content;
    const edited = `${original.split('\n')[0]}\nsequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Edited`;

    const result = await runMarkdownSaveJob(
      { filePath: '/tmp/notes.md', index: 1, content: edited, expectedContent: original },
      deps,
    );

    expect(result.status).toBe('done');
    expect(state.writes).toHaveLength(1);
    const written = state.content;
    // prose and the other block are untouched
    expect(written.startsWith('# Doc\n\nIntro.\n\n')).toBe(true);
    expect(written).toContain('A->>B: First');
    expect(written).toContain('\nMiddle.\n');
    expect(written.endsWith('\nOutro.\n')).toBe(true);
    // the edited block keeps its config comment as the first line
    const blocks = extractMermaidBlocks(written);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].content).toBe(edited);
    expect(blocks[1].content.split('\n')[0]).toContain('%% CONFIG:');
  });

  it('fails with conflict when the block changed on disk; nothing is written', async () => {
    const { state, deps } = makeDeps(MD);
    const stale = extractMermaidBlocks(MD)[0].content;
    // someone else edits the file between load and save
    state.content = MD.replace('A->>B: First', 'A->>B: External edit');

    await expect(
      runMarkdownSaveJob(
        { filePath: '/tmp/notes.md', index: 0, content: 'sequenceDiagram\nA->>B: Mine', expectedContent: stale },
        deps,
      )
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(state.writes).toHaveLength(0);
    expect(state.content).toContain('A->>B: External edit');
  });

  it('fails with not-found when the diagram index does not exist', async () => {
    const { state, deps } = makeDeps(MD);
    await expect(
      runMarkdownSaveJob(
        { filePath: '/tmp/notes.md', index: 5, content: 'x', expectedContent: 'x' },
        deps,
      )
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(state.writes).toHaveLength(0);
  });

  it('fails with read-failed when the file cannot be read', async () => {
    const deps: MarkdownSaveDeps = {
      readFileVersion: async () => { throw new Error('ENOENT'); },
      writeFile: async () => {},
    };
    await expect(
      runMarkdownSaveJob(
        { filePath: '/tmp/missing.md', index: 0, content: 'x', expectedContent: 'x' },
        deps,
      )
    ).rejects.toBeInstanceOf(JobError);
    await expect(
      runMarkdownSaveJob(
        { filePath: '/tmp/missing.md', index: 0, content: 'x', expectedContent: 'x' },
        deps,
      )
    ).rejects.toMatchObject({ code: 'read-failed' });
  });

  it('keeps the storage error code when the file is missing at job time (not-found)', async () => {
    const deps: MarkdownSaveDeps = {
      readFileVersion: async () => { throw new StorageError('not-found', 'File not found: notes.md'); },
      writeFile: async () => {},
    };
    await expect(
      runMarkdownSaveJob(
        { filePath: '/tmp/missing.md', index: 0, content: 'x', expectedContent: 'x' },
        deps,
      )
    ).rejects.toMatchObject({ code: 'not-found', message: 'File not found: notes.md' });
  });

  it('round-trips a no-op save byte-identically', async () => {
    const { state, deps } = makeDeps(MD);
    const original = extractMermaidBlocks(MD)[0].content;
    await runMarkdownSaveJob(
      { filePath: '/tmp/notes.md', index: 0, content: original, expectedContent: original },
      deps,
    );
    expect(state.content).toBe(MD);
  });

  it('fails with verify-failed when written content on disk does not match expected content', async () => {
    const { state, deps } = makeDeps(MD);
    const original = extractMermaidBlocks(MD)[0].content;
    // Simulate disk corruption during write
    deps.writeFile = async (_path, _content) => {
      state.content = 'corrupted disk content';
      state.version += 1;
    };
    await expect(
      runMarkdownSaveJob(
        { filePath: '/tmp/notes.md', index: 0, content: 'sequenceDiagram\nA->>B: New', expectedContent: original },
        deps,
      )
    ).rejects.toMatchObject({
      code: 'verify-failed',
      message: expect.stringContaining("Contents aren't saved"),
    });
  });

  it('fails with verify-failed when diagrams in the saved markdown cannot be extracted or are missing', async () => {
    const { state, deps } = makeDeps(MD);
    const original = extractMermaidBlocks(MD)[0].content;
    // Simulate disk write that omitted the diagram block
    deps.writeFile = async (_path, _content) => {
      state.content = '# Notes\n\nNo diagrams here.\n';
      state.version += 1;
    };
    await expect(
      runMarkdownSaveJob(
        { filePath: '/tmp/notes.md', index: 0, content: 'sequenceDiagram\nA->>B: New', expectedContent: original },
        deps,
      )
    ).rejects.toMatchObject({
      code: 'verify-failed',
      message: expect.stringContaining("Contents aren't saved"),
    });
  });

  it('passes the file version to writeFile (CAS), and succeeds when it still matches', async () => {
    const { state, deps } = makeDeps(MD);
    const original = extractMermaidBlocks(MD)[0].content;
    const seen: Array<string | undefined> = [];
    const inner = deps.writeFile;
    deps.writeFile = async (p, c, opts) => {
      seen.push(opts?.ifMatchVersion);
      return inner(p, c, opts);
    };
    await runMarkdownSaveJob(
      { filePath: '/tmp/notes.md', index: 0, content: original, expectedContent: original },
      deps,
    );
    expect(seen).toEqual(['v0']);
    expect(state.writes).toHaveLength(1);
  });

  it('fails with conflict and writes nothing when the file version changed between read and write', async () => {
    const { state, deps } = makeDeps(MD);
    const original = extractMermaidBlocks(MD)[0].content;
    // An external write lands between the job's read and its write.
    deps.writeFile = async () => {
      throw new StorageError('conflict', 'The file changed on disk since it was read; reload it before saving (notes.md)');
    };
    await expect(
      runMarkdownSaveJob(
        { filePath: '/tmp/notes.md', index: 0, content: 'sequenceDiagram\nA->>B: New', expectedContent: original },
        deps,
      )
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(state.writes).toHaveLength(0);
    expect(state.content).toBe(MD);
  });

  it('translates a storage unavailable error from the write into a job error with the same code', async () => {
    const { deps } = makeDeps(MD);
    const original = extractMermaidBlocks(MD)[0].content;
    deps.writeFile = async () => {
      throw new StorageError('unavailable', 'S3 unavailable after 3 attempts');
    };
    await expect(
      runMarkdownSaveJob(
        { filePath: '/tmp/notes.md', index: 0, content: original, expectedContent: original },
        deps,
      )
    ).rejects.toMatchObject({ code: 'unavailable', message: 'S3 unavailable after 3 attempts' });
  });
});
