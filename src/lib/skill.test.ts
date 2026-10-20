import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseViewsData } from './views';
import { parseModel } from './model';
import { extractRegions } from './parser';

describe('AI Agent Skill — diagram-authoring', () => {
  const workspaceRoot = process.cwd();
  const skillMdPath = path.join(workspaceRoot, 'skills', 'diagram-authoring', 'SKILL.md');
  const agentSkillMdPath = path.join(workspaceRoot, '.agents', 'skills', 'diagram-authoring', 'SKILL.md');
  const exampleDiagramPath = path.join(workspaceRoot, 'skills', 'diagram-authoring', 'examples', 'sequence-with-metadata.mmd');

  it('SKILL.md exists in skills/ and .agents/skills/ with valid frontmatter', () => {
    expect(fs.existsSync(skillMdPath)).toBe(true);
    expect(fs.existsSync(agentSkillMdPath)).toBe(true);

    const content = fs.readFileSync(skillMdPath, 'utf8');
    expect(content.startsWith('---')).toBe(true);

    const frontmatterEnd = content.indexOf('---', 3);
    expect(frontmatterEnd).toBeGreaterThan(3);

    const frontmatter = content.slice(3, frontmatterEnd);
    expect(frontmatter).toContain('name: diagram-authoring');
    expect(frontmatter).toContain('description:');
    expect(frontmatter).toContain('CONFIG');
    expect(frontmatter).toContain('metadata');
  });

  it('SKILL.md thoroughly covers metadata schemas, regions, colors, and authoring guidelines', () => {
    const content = fs.readFileSync(skillMdPath, 'utf8');

    // Required concepts for AI agents authoring diagrams
    expect(content).toContain('%% CONFIG:');
    expect(content).toContain('DiagramConfig');
    expect(content).toContain('ActorMetadata');
    expect(content).toContain('ArrowStyle');
    expect(content).toContain('ArrowAnimationType');
    expect(content).toContain('%% @region-start:');
    expect(content).toContain('%% @region-end');
    expect(content).toContain('box <Title>');
    expect(content).toContain('#00ff9d'); // Happy path emerald
    expect(content).toContain('#ff2a85'); // Error rose
    expect(content).toContain('Authoring Checklist for AI Agents');
  });

  it('example diagram in skill contains valid metadata and parses correctly with Foliant parsers', () => {
    expect(fs.existsSync(exampleDiagramPath)).toBe(true);
    const mmdContent = fs.readFileSync(exampleDiagramPath, 'utf8');

    // 1. Verify %% CONFIG line parses successfully
    const config = parseViewsData(mmdContent);
    expect(config).not.toBeNull();
    expect(config?.version).toBe(1);
    expect(config?.actors).toBeDefined();
    expect(config?.actors?.Client?.color).toBe('#213b5e');
    expect(config?.actors?.Client?.keys).toContain('frontend');
    expect(config?.arrows?.length).toBeGreaterThan(0);
    expect(config?.views?.length).toBeGreaterThan(0);

    // 2. Verify Mermaid model parses successfully
    const model = parseModel(mmdContent);
    expect(model.type).toBe('sequence');
    const participants = model.elements.filter(e => e.kind === 'participant');
    expect(participants.length).toBe(4);
    const ids = participants.map(p => p.id);
    expect(ids).toContain('Client');
    expect(ids).toContain('Gateway');
    expect(ids).toContain('Auth');
    expect(ids).toContain('DB');

    // 3. Verify regions parse successfully
    const regions = extractRegions(mmdContent);
    expect(regions.length).toBeGreaterThan(0);
    const flowRegion = regions.find(r => r.type === 'flow' && r.value === 'login');
    expect(flowRegion).toBeDefined();
    const edgeCaseRegion = flowRegion?.children.find(r => r.type === 'edge-case' && r.value === 'invalid-credentials');
    expect(edgeCaseRegion).toBeDefined();
  });
});
