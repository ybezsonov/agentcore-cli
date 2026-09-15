import type { HarnessSpec } from '../../../../../schema/schemas/primitives/harness';
import type { AgentRenderConfig } from '../../../../templates/types';
import { PATH_SKILLS_COPIED_NOTE_CATEGORY } from '../../constants';
import type { ResolvedHarnessContext } from '../../types';
import {
  INVALID_SKILLS_NOTE_CATEGORY,
  JAVA_NO_SKILLS_STAGED_NOTE_CATEGORY,
  PATH_SKILLS_NOT_STAGED_NOTE_CATEGORY,
} from '../constants';
import { hasFrontMatterName, stageJavaSkills } from '../skills';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

describe('hasFrontMatterName', () => {
  // Expected results come from spring-ai-agent-utils 0.12.0 MarkdownParser: true means SkillsTool gets a
  // name, false means Skill.name() throws at boot.
  it.each([
    ['name: good', '---\nname: good\n---\nbody', true],
    ['no front matter', 'name: good\n', false],
    ['front matter without name', '---\ndescription: d\n---\n', false],
    ['unclosed front matter', '---\nname: good\n', false],
    ['invalid YAML value', '---\nname: [broken\n---\n', true],
    ['indented name', '---\nmetadata:\n  name: nested\n---\n', true],
    ['space before the colon', '---\nname : spaced\n---\n', true],
    ['empty name', '---\nname:\n---\n', true],
    ['CRLF line endings', '---\r\nname: good\r\n---\r\n', true],
    ['--- inside a value before name', '---\ndescription: contains --- here\nname: good\n---\n', false],
    ['leading BOM', '\uFEFF---\nname: good\n---\n', false],
  ])('%s', (_label, markdown, expected) => {
    expect(hasFrontMatterName(markdown)).toBe(expected);
  });
});

describe('stageJavaSkills', () => {
  let root: string;
  let agentDir: string;
  const skillsRoot = () => join(agentDir, 'src', 'main', 'resources', 'skills');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'java-skills-'));
    agentDir = join(root, 'app', 'MyAgent');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function writeSkill(path: string, skillMd?: string) {
    const dir = join(root, 'app', 'MyHarness', path);
    mkdirSync(dir, { recursive: true });
    if (skillMd !== undefined) writeFileSync(join(dir, 'SKILL.md'), skillMd);
  }

  function stage(skills: (string | { gitUrl: string; path?: string })[]) {
    const context = {
      harnessName: 'MyHarness',
      targetAgentName: 'MyAgent',
      projectRoot: root,
      spec: {
        skills: skills.map(skill => (typeof skill === 'string' ? { path: skill } : skill)),
      } as unknown as HarnessSpec,
      exportNotes: [],
    } as unknown as ResolvedHarnessContext;
    const renderConfig = { hasSkillsFetcher: skills.length > 0 } as AgentRenderConfig;
    stageJavaSkills(context, renderConfig, agentDir);
    return { renderConfig, categories: context.exportNotes.map(note => note.category) };
  }

  it('stages a skill with a named SKILL.md and keeps the skills tool', () => {
    writeSkill('skills/greeting', '---\nname: greeting\ndescription: Greets.\n---\nSay hello.\n');
    const { renderConfig, categories } = stage(['skills/greeting']);
    expect(existsSync(join(skillsRoot(), 'greeting', 'SKILL.md'))).toBe(true);
    expect(renderConfig.hasSkillsFetcher).toBe(true);
    expect(categories).toEqual([PATH_SKILLS_COPIED_NOTE_CATEGORY]);
  });

  it('drops the skills tool for an empty skill directory, which fails SkillsTool at boot', () => {
    writeSkill('skills/empty');
    const { renderConfig, categories } = stage(['skills/empty']);
    expect(existsSync(join(skillsRoot(), 'empty'))).toBe(false);
    expect(renderConfig.hasSkillsFetcher).toBe(false);
    expect(categories).toEqual([INVALID_SKILLS_NOTE_CATEGORY, JAVA_NO_SKILLS_STAGED_NOTE_CATEGORY]);
  });

  it('removes a skill whose SKILL.md has no name and keeps the valid ones', () => {
    writeSkill('skills/good', '---\nname: good\n---\n');
    writeSkill('skills/nameless', '---\ndescription: No name.\n---\n');
    const { renderConfig, categories } = stage(['skills/good', 'skills/nameless']);
    expect(existsSync(join(skillsRoot(), 'good'))).toBe(true);
    expect(existsSync(join(skillsRoot(), 'nameless'))).toBe(false);
    expect(renderConfig.hasSkillsFetcher).toBe(true);
    expect(categories).toEqual([PATH_SKILLS_COPIED_NOTE_CATEGORY, INVALID_SKILLS_NOTE_CATEGORY]);
  });

  it('reports a path that is missing or leaves the harness directory', () => {
    const { renderConfig, categories } = stage(['skills/missing', '../outside']);
    expect(renderConfig.hasSkillsFetcher).toBe(false);
    expect(categories).toEqual([PATH_SKILLS_NOT_STAGED_NOTE_CATEGORY, JAVA_NO_SKILLS_STAGED_NOTE_CATEGORY]);
  });

  it('stages a path ending in "." under its directory name', () => {
    writeSkill('skills/dot', '---\nname: dot\n---\n');
    stage(['skills/dot/.']);
    expect(existsSync(join(skillsRoot(), 'dot', 'SKILL.md'))).toBe(true);
  });

  it('keeps staged skills when an invalid git skill points at the repo root', () => {
    // The clone writes a nameless SKILL.md at the root of the repository.
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const dest = (args as string[]).at(-1)!;
      writeFileSync(join(dest, 'SKILL.md'), '---\ndescription: No name.\n---\n');
      return Buffer.from('');
    });
    writeSkill('skills/good', '---\nname: good\n---\n');
    const { renderConfig, categories } = stage([
      'skills/good',
      { gitUrl: 'https://example.com/team/catalog.git', path: '.' },
    ]);
    expect(existsSync(join(skillsRoot(), 'good', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillsRoot(), 'catalog'))).toBe(false);
    expect(renderConfig.hasSkillsFetcher).toBe(true);
    expect(categories).toEqual([PATH_SKILLS_COPIED_NOTE_CATEGORY, INVALID_SKILLS_NOTE_CATEGORY]);
  });

  it('stages a valid git skill at the repo root under the repository name', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const dest = (args as string[]).at(-1)!;
      writeFileSync(join(dest, 'SKILL.md'), '---\nname: catalog\n---\n');
      return Buffer.from('');
    });
    const { renderConfig } = stage([{ gitUrl: 'https://example.com/team/catalog.git', path: '.' }]);
    expect(existsSync(join(skillsRoot(), 'catalog', 'SKILL.md'))).toBe(true);
    expect(renderConfig.hasSkillsFetcher).toBe(true);
  });
});
