import type { HarnessSkillGitSource } from '../../../../schema/schemas/primitives/harness';
import type { AgentRenderConfig } from '../../../templates/types';
import { PATH_SKILLS_COPIED_NOTE_CATEGORY } from '../constants';
import { isGitSkill, isPathSkill } from '../harness-mapper';
import type { ExportNote, ResolvedHarnessContext } from '../types';
import {
  GIT_SKILLS_CLONED_NOTE_CATEGORY,
  GIT_SKILLS_CLONE_FAILED_NOTE_CATEGORY,
  INVALID_SKILLS_NOTE_CATEGORY,
  JAVA_NO_SKILLS_STAGED_NOTE_CATEGORY,
  PATH_SKILLS_NOT_STAGED_NOTE_CATEGORY,
} from './constants';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';

/**
 * Stages the harness path skills and public git skills into src/main/resources/skills/, where the
 * SkillsTool loads them from the jar. Public git skills are shallow-cloned here, so the image needs
 * no git and the runtime fetches nothing. Private git and s3 skills are left out; the coverage note
 * reports them.
 *
 * SkillsTool fails at boot when the catalog is empty or a SKILL.md has no `name`, so a skill without
 * a named SKILL.md is removed again, and the skills tool is left out when no skill is left. Each skill
 * gets its own subdirectory, so removing one never touches another.
 */
export function stageJavaSkills(context: ResolvedHarnessContext, renderConfig: AgentRenderConfig, agentDir: string) {
  const { targetAgentName } = context;
  const harnessDir = join(context.projectRoot, 'app', context.harnessName);
  const skillsRoot = join(agentDir, 'src', 'main', 'resources', 'skills');
  const usedNames = new Set<string>();
  const notes: ExportNote[] = [];

  /** Copies one skill directory in. Returns false when it has no SKILL.md with a name. */
  const stage = (source: string, baseName: string): boolean => {
    const dest = join(skillsRoot, uniqueSkillDirName(skillDirName(baseName), usedNames));
    mkdirSync(dest, { recursive: true });
    cpSync(source, dest, { recursive: true });
    if (!hasOnlyNamedSkills(dest)) {
      rmSync(dest, { recursive: true, force: true });
      return false;
    }
    return true;
  };

  const copied: string[] = [];
  const unresolved: string[] = [];
  const invalid: string[] = [];
  for (const skill of context.spec.skills) {
    if (!isPathSkill(skill) || !skill.path) continue;
    const source = join(harnessDir, skill.path);
    // Reject absolute paths and traversal — must resolve to a dir inside the harness dir.
    const escapesHarness = isAbsolute(skill.path) || !resolve(source).startsWith(resolve(harnessDir) + sep);
    if (escapesHarness || !existsSync(source)) unresolved.push(skill.path);
    else if (stage(source, basename(resolve(source)))) copied.push(skill.path);
    else invalid.push(skill.path);
  }

  const cloned: string[] = [];
  const failed: string[] = [];
  for (const skill of context.spec.skills) {
    if (!isGitSkill(skill) || skill.auth?.credentialName) continue;
    const result = clonePublicGitSkill(skill, stage);
    if (result === 'staged') cloned.push(skill.gitUrl);
    else if (result === 'invalid') invalid.push(skill.gitUrl);
    else failed.push(skill.gitUrl);
  }

  const list = (items: string[]) => items.map(item => `"${item}"`).join(', ');
  const dest = `app/${targetAgentName}/src/main/resources/skills/`;
  if (copied.length > 0) {
    notes.push({
      category: PATH_SKILLS_COPIED_NOTE_CATEGORY,
      message:
        `The following path skills were copied into ${dest}, so they are packaged into the Spring Boot jar and ` +
        `loaded by the SkillsTool — no manual step required: ${list(copied)}.`,
    });
  }
  if (unresolved.length > 0) {
    notes.push({
      category: PATH_SKILLS_NOT_STAGED_NOTE_CATEGORY,
      message:
        `The following path skills were not found locally under the harness directory, so they were NOT staged ` +
        `into ${dest} and are not in the jar: ${list(unresolved)}. Add the skill directories there, or fix the ` +
        `paths and re-export.`,
    });
  }
  if (cloned.length > 0) {
    notes.push({
      category: GIT_SKILLS_CLONED_NOTE_CATEGORY,
      message:
        `The following public git skill repositories were shallow-cloned at export and staged into ${dest}, so ` +
        `they are packaged into the Spring Boot jar and loaded by the SkillsTool — no git in the image, no runtime ` +
        `fetch: ${list(cloned)}. Re-export to refresh the snapshot.`,
    });
  }
  if (failed.length > 0) {
    notes.push({
      category: GIT_SKILLS_CLONE_FAILED_NOTE_CATEGORY,
      message:
        `The following git skill repositories could not be cloned at export, so they were NOT staged into ` +
        `app/${targetAgentName}/: ${list(failed)}. Ensure \`git\` and network access are available and the URL is a ` +
        `public HTTPS repo, then re-export. (Private repos are not yet supported for Java export.)`,
    });
  }
  if (invalid.length > 0) {
    notes.push({
      category: INVALID_SKILLS_NOTE_CATEGORY,
      message:
        `The following skills have no SKILL.md with a \`name\` in its front matter, so they were NOT staged into ` +
        `${dest}: ${list(invalid)}. Fix the SKILL.md files and re-export.`,
    });
  }
  if (renderConfig.hasSkillsFetcher && (!existsSync(skillsRoot) || findSkillFiles(skillsRoot).length === 0)) {
    renderConfig.hasSkillsFetcher = false;
    notes.push({
      category: JAVA_NO_SKILLS_STAGED_NOTE_CATEGORY,
      message:
        `None of the harness skills could be staged into ${dest}, so the generated agent has no skills tool. ` +
        `Add a path or public git skill with a named SKILL.md to the harness and re-export.`,
    });
  }
  context.exportNotes.push(...notes);
}

/** Clones a public git skill and stages its directory. Returns 'failed' when it cannot be cloned. */
function clonePublicGitSkill(
  skill: HarnessSkillGitSource,
  stage: (source: string, baseName: string) => boolean
): 'staged' | 'invalid' | 'failed' {
  const subPath = skill.path;
  // Defensive: the schema enforces https; reject an absolute/traversing repo subdir.
  if (
    !skill.gitUrl.startsWith('https://') ||
    (subPath && (isAbsolute(subPath) || subPath.split(/[\\/]/).includes('..')))
  ) {
    return 'failed';
  }
  let tmp: string | undefined;
  try {
    tmp = mkdtempSync(join(tmpdir(), 'agentcore-gitskill-'));
    // execFileSync (no shell) avoids command injection from the URL.
    execFileSync('git', ['clone', '--depth', '1', '--quiet', skill.gitUrl, tmp], { stdio: 'ignore', timeout: 120_000 });
    rmSync(join(tmp, '.git'), { recursive: true, force: true });
    const source = resolve(tmp, subPath ?? '.');
    if (!existsSync(source)) return 'failed';
    const baseName = source === resolve(tmp) ? repoDirName(skill.gitUrl) : basename(source);
    return stage(source, baseName) ? 'staged' : 'invalid';
  } catch {
    // git missing, no network, private repo, or a bad URL — the export still succeeds with a note.
    return 'failed';
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * True when a directory has at least one SKILL.md, found the way SkillsTool finds them, and every one
 * has a `name` in its front matter (SkillsTool fails at boot on a SKILL.md without one).
 */
function hasOnlyNamedSkills(dir: string): boolean {
  const skillFiles = findSkillFiles(dir);
  return skillFiles.length > 0 && skillFiles.every(file => hasFrontMatterName(readFileSync(file, 'utf-8')));
}

function findSkillFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findSkillFiles(path);
    return entry.isFile() && entry.name === 'SKILL.md' ? [path] : [];
  });
}

/**
 * Reads the front matter the way spring-ai-agent-utils 0.12.0 MarkdownParser does: it starts at a
 * leading `---` and ends at the next `---` anywhere; each trimmed line is split at its first `:`. This
 * is not YAML, so the check must not be stricter or looser than the parser.
 */
export function hasFrontMatterName(markdown: string): boolean {
  if (!markdown.startsWith('---')) return false;
  const end = markdown.indexOf('---', 3);
  if (end === -1) return false;
  return markdown
    .slice(3, end)
    .split('\n')
    .some(line => {
      const trimmed = javaTrim(line);
      const colon = trimmed.indexOf(':');
      return colon > 0 && javaTrim(trimmed.slice(0, colon)) === 'name';
    });
}

/** Java's String.trim(): strips characters up to U+0020 only. */
function javaTrim(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start++;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
  return value.slice(start, end);
}

/** A single directory name for a skill: no separators, never `.` or `..`. */
function skillDirName(base: string): string {
  const name = base.replace(/[\\/]/g, '-');
  return /^\.*$/.test(name) ? 'skill' : name;
}

/** Collision-safe skill subdirectory name (SkillsTool keys skills by their SKILL.md `name`). */
function uniqueSkillDirName(base: string, used: Set<string>): string {
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
  used.add(name);
  return name;
}

/** Last path segment of a git URL, minus any `.git` suffix (fallback skill dir name). */
function repoDirName(url: string): string {
  const noQuery = url.split(/[#?]/)[0]!.replace(/\/+$/, '');
  const last = noQuery.split('/').filter(Boolean).pop() ?? 'skill';
  return last.replace(/\.git$/, '') || 'skill';
}
