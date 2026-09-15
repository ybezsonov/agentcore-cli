import { AgentAlreadyExistsError, ConfigIO, setEnvVar } from '../../../lib';
import { ExportHarnessError, ValidationError } from '../../../lib/errors/types';
import { AgentNameSchema, SDKFrameworkSchema, TargetLanguageSchema, matchEnumValue } from '../../../schema';
import type { AgentEnvSpec, BuildType, Credential, HarnessSpec, SDKFramework, TargetLanguage } from '../../../schema';
import { getErrorMessage } from '../../errors';
import { regionFromHarnessArn } from '../../operations/harness/orphan';
import type { AttributeRecorder } from '../../telemetry/cli-command-run.js';
import { withCommandRunTelemetry } from '../../telemetry/cli-command-run.js';
import type { CommandAttrs } from '../../telemetry/schemas/command-run.js';
import {
  BuildType as TelemetryBuildType,
  ModelProvider as TelemetryModelProvider,
  standardize,
} from '../../telemetry/schemas/common-shapes.js';
import { createRenderer } from '../../templates';
import {
  CUSTOM_DOCKERFILE_NOTE_CATEGORY,
  EXPORT_NOTES_FILENAME,
  GIT_SKILLS_CLONED_NOTE_CATEGORY,
  GIT_SKILLS_CLONE_FAILED_NOTE_CATEGORY,
  PATH_SKILLS_COPIED_NOTE_CATEGORY,
  PATH_SKILLS_VERIFY_BASE_IMAGE_NOTE_CATEGORY,
} from './constants';
import { fetchHarnessSpecByArn } from './fetch-harness-spec';
import { isGitSkill, isPathSkill, mapHarnessToExportConfig } from './harness-mapper';
import { resolveHarnessContext } from './harness-resolver';
import type { ExportHarnessOptions, ExportLanguageConfig, ExportNote, ResolvedHarnessContext } from './types';
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';

export interface ExportHarnessProgress {
  onProgress?: (message: string) => void;
}

/**
 * Resolve + validate the export target language/framework from the CLI flags. Defaults to
 * Python/Strands (the pre-Java behaviour); Java defaults to SpringAI. Harness export supports exactly
 * these two language→framework pairs today, so anything else is a fixable user error, not a crash.
 */
function resolveExportLanguageConfig(
  options: ExportHarnessOptions
): { config: ExportLanguageConfig } | { error: ValidationError } {
  let targetLanguage: TargetLanguage = 'Python';
  if (options.language) {
    const matched = matchEnumValue(TargetLanguageSchema, options.language);
    if (matched !== 'Python' && matched !== 'Java') {
      return {
        error: new ValidationError(
          `Unsupported --language "${options.language}". Harness export supports: Python, Java.`
        ),
      };
    }
    targetLanguage = matched as TargetLanguage;
  }

  const defaultFramework: SDKFramework = targetLanguage === 'Java' ? 'SpringAI' : 'Strands';
  if (options.framework && matchEnumValue(SDKFrameworkSchema, options.framework) !== defaultFramework) {
    return {
      error: new ValidationError(
        `Unsupported --framework "${options.framework}" for ${targetLanguage}. Expected ${defaultFramework}.`
      ),
    };
  }

  return { config: { targetLanguage, sdkFramework: defaultFramework } };
}

export async function handleExportHarness(
  options: ExportHarnessOptions,
  progress?: ExportHarnessProgress
): Promise<
  | { success: true; agentName: string; agentPath: string; notesPath: string; notes: ExportNote[] }
  | { success: false; error: Error }
> {
  const log = (msg: string) => progress?.onProgress?.(msg);

  return withCommandRunTelemetry(
    'export.harness',
    {} as CommandAttrs<'export.harness'>,
    async (recorder: AttributeRecorder<CommandAttrs<'export.harness'>>) => {
      if (!!options.name === !!options.arn) {
        return {
          success: false as const,
          error: new ValidationError('Specify exactly one of --name (local harness) or --arn (fetched harness).'),
        };
      }

      const buildOverride = options.build as BuildType | undefined;
      const VALID_BUILD_TYPES = new Set<string>(['CodeZip', 'Container']);
      if (buildOverride && !VALID_BUILD_TYPES.has(buildOverride)) {
        return {
          success: false as const,
          error: new ValidationError(`Invalid --build value "${buildOverride}". Expected CodeZip or Container.`),
        };
      }

      const langResult = resolveExportLanguageConfig(options);
      if ('error' in langResult) return { success: false as const, error: langResult.error };
      const langConfig = langResult.config;
      const isJava = langConfig.targetLanguage === 'Java';

      // For --arn, fetch the harness from the service first so we can derive its name. The fetch
      // needs a region — taken from the project's first deployment target.
      let prefetched: { spec: HarnessSpec; systemPrompt?: string } | undefined;
      if (options.arn) {
        log('Fetching harness from service');
        const region = await resolveExportRegion(options.arn);
        if (!region) {
          return {
            success: false as const,
            error: new ValidationError(
              'No AWS region configured. Pass an ARN that includes a region, configure a deployment ' +
                'target (agentcore/aws-targets.json), or set AWS_REGION before exporting by ARN.'
            ),
          };
        }
        try {
          prefetched = await fetchHarnessSpecByArn(options.arn, region);
        } catch (err) {
          return { success: false as const, error: err instanceof Error ? err : new Error(String(err)) };
        }
      }

      const harnessName = options.name ?? prefetched!.spec.name;
      const targetAgentName = options.targetAgentName ?? `${harnessName}Agent`;
      const parsedAgentName = AgentNameSchema.safeParse(targetAgentName);
      if (!parsedAgentName.success) {
        return {
          success: false as const,
          error: new ValidationError(
            `Invalid --target-agent-name "${targetAgentName}": ${parsedAgentName.error.issues[0]?.message ?? 'invalid name'}`
          ),
        };
      }

      // 1. Resolve all on-disk inputs (+ the prefetched spec for the --arn path)
      log('Reading harness configuration');
      let context: Awaited<ReturnType<typeof resolveHarnessContext>>;
      try {
        context = await resolveHarnessContext(harnessName, targetAgentName, undefined, prefetched);
      } catch (err) {
        return { success: false as const, error: err instanceof Error ? err : new Error(String(err)) };
      }

      // 2. Map harness spec to render config + agent env spec
      log(`Mapping to ${langConfig.sdkFramework} template config`);
      const { renderConfig, agentEnvSpec, credentialEntry, mcpCredentialEntries, gitCredentialEntries } =
        mapHarnessToExportConfig(context, buildOverride, langConfig);

      // The target directory is guaranteed not to pre-exist (resolveHarnessContext throws if it
      // does), so anything written below is created by this export. Remove it on failure to avoid
      // leaving an orphan directory with no matching agentcore.json entry.
      const agentDir = join(context.projectRoot, 'app', targetAgentName);
      const cleanupAgentDir = () => {
        try {
          rmSync(agentDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup — ignore failures
        }
      };

      // 3. Copy Dockerfile + supporting harness directories (e.g. path_skill/, assets/)
      //    Harness files that are NOT copied: harness.json, system-prompt.md (regenerated by export)
      const HARNESS_SKIP_FILES = new Set(['harness.json', 'system-prompt.md']);
      if (context.spec.dockerfile) {
        const harnessDir = join(context.projectRoot, 'app', harnessName);
        const dockerfileSrc = join(harnessDir, context.spec.dockerfile);
        if (existsSync(dockerfileSrc)) {
          mkdirSync(agentDir, { recursive: true });
          copyFileSync(dockerfileSrc, join(agentDir, context.spec.dockerfile));
          context.exportNotes.push(buildCustomDockerfileNote(context.spec.dockerfile, targetAgentName));
        } else {
          context.exportNotes.push(buildMissingDockerfileNote(context.spec.dockerfile, harnessName, targetAgentName));
        }
        // Copy all non-file entries (directories) and non-skipped files from the harness dir
        if (existsSync(harnessDir)) {
          cpSync(harnessDir, agentDir, {
            recursive: true,
            filter: src => {
              const name = basename(src);
              return !HARNESS_SKIP_FILES.has(name);
            },
          });
        }
      }

      // 3b. Path skills → bundle into the image. The custom-dockerfile branch above already copies
      //     the whole harness dir, but a plain `--build Container` / containerUri build uses a
      //     generated Dockerfile and the harness dir is NOT otherwise copied, so copy each locally
      //     resolvable path-skill directory in. Java packages them as classpath resources under
      //     src/main/resources/skills/<dir>/ (bundled into the Spring Boot jar, then discovered by the
      //     community SkillsTool via classpath scanning); Python/TS keep the harness-relative path so
      //     the generated Dockerfile's `COPY . .` bundles them. Unresolvable paths (absolute,
      //     traversal, or not found locally) are assumed to live in the base image and get a
      //     verify-note instead. (Container only — CodeZip path skills are unsupported and already
      //     noted by the mapper.)
      if (!context.spec.dockerfile && renderConfig.buildType === 'Container') {
        const harnessDir = join(context.projectRoot, 'app', harnessName);
        const javaSkillsRoot = join(agentDir, 'src', 'main', 'resources', 'skills');
        const usedJavaDestNames = new Set<string>();
        const copied: string[] = [];
        const unresolved: string[] = [];
        for (const skill of context.spec.skills) {
          // Only pure path skills (a git skill carries `path` as a repo subdir, not a local dir).
          if (!isPathSkill(skill) || !skill.path) continue;
          const skillPath = skill.path;
          const skillSrc = join(harnessDir, skillPath);
          // Reject absolute paths and traversal — must resolve to a dir inside the harness dir.
          const escapesHarness = isAbsolute(skillPath) || !resolve(skillSrc).startsWith(resolve(harnessDir) + sep);
          if (!escapesHarness && existsSync(skillSrc)) {
            // Java: SkillsTool keys skills by their SKILL.md `name`, so the on-disk subdir name is
            // cosmetic — use the (collision-safe) source basename under src/main/resources/skills/.
            const skillDest = isJava
              ? join(javaSkillsRoot, uniqueSkillDirName(basename(skillPath) || 'skill', usedJavaDestNames))
              : join(agentDir, skillPath);
            mkdirSync(skillDest, { recursive: true });
            cpSync(skillSrc, skillDest, { recursive: true });
            copied.push(skillPath);
          } else {
            unresolved.push(skillPath);
          }
        }
        if (copied.length > 0) {
          context.exportNotes.push(buildPathSkillsCopiedNote(copied, targetAgentName, isJava));
        }
        if (unresolved.length > 0) {
          context.exportNotes.push(buildPathSkillsVerifyNote(unresolved, targetAgentName));
        }

        // Java: PUBLIC git skills are shallow-cloned here at export and staged into the classpath
        // skills dir (exactly like path skills), so the runtime loads them inert from the jar — no
        // git in the image, no runtime fetch, catalog baked at build. PRIVATE git skills (auth) need a
        // runtime AgentCore workload-identity token to resolve the credential and are deferred
        // (B3c-private) — they stay flagged in the Java coverage note. Python/TS clone at runtime.
        if (isJava) {
          const gitStaged: string[] = [];
          const gitFailed: string[] = [];
          for (const skill of context.spec.skills) {
            if (!isGitSkill(skill) || skill.auth?.credentialName) continue; // public git only
            const url = skill.gitUrl;
            const subPath = skill.path;
            // Defensive: the schema enforces https; reject an absolute/traversing repo subdir.
            if (
              !url.startsWith('https://') ||
              (subPath && (isAbsolute(subPath) || subPath.split(/[\\/]/).includes('..')))
            ) {
              gitFailed.push(url);
              continue;
            }
            let tmp: string | undefined;
            try {
              tmp = mkdtempSync(join(tmpdir(), 'agentcore-gitskill-'));
              // execFileSync (no shell) avoids command injection from the URL.
              execFileSync('git', ['clone', '--depth', '1', '--quiet', url, tmp], {
                stdio: 'ignore',
                timeout: 120_000,
              });
              rmSync(join(tmp, '.git'), { recursive: true, force: true });
              const srcDir = subPath ? join(tmp, subPath) : tmp;
              if (!existsSync(srcDir)) {
                gitFailed.push(url);
                continue;
              }
              const destName = uniqueSkillDirName(basename(subPath ?? repoDirName(url)) || 'skill', usedJavaDestNames);
              const dest = join(javaSkillsRoot, destName);
              mkdirSync(dest, { recursive: true });
              cpSync(srcDir, dest, { recursive: true });
              gitStaged.push(url);
            } catch {
              // git missing, no network, private repo, or a bad URL/subdir — fall back to a note so the
              // export still succeeds; the user provides the skill in the image or fixes the URL.
              gitFailed.push(url);
            } finally {
              if (tmp) rmSync(tmp, { recursive: true, force: true });
            }
          }
          if (gitStaged.length > 0) {
            context.exportNotes.push(buildGitSkillsClonedNote(gitStaged, targetAgentName));
          }
          if (gitFailed.length > 0) {
            context.exportNotes.push(buildGitSkillsClonedFailedNote(gitFailed, targetAgentName));
          }
        }
      }

      // 4. Generate Dockerfile stub for containerUri
      if (context.spec.containerUri && renderConfig.buildType === 'Container') {
        mkdirSync(agentDir, { recursive: true });
        writeDockerfileStub(agentDir, context.spec.containerUri);
      }

      // 5. Render agent code (createRenderer dispatches on sdkFramework: Strands→Python, SpringAI→Java)
      log('Rendering agent code');
      try {
        const renderer = createRenderer(renderConfig);
        await renderer.render({ outputDir: context.projectRoot });
      } catch (err) {
        cleanupAgentDir();
        return {
          success: false as const,
          error: new ExportHarnessError(
            `Failed to render agent code for "${targetAgentName}": ${getErrorMessage(err)}`,
            {
              cause: err instanceof Error ? err : undefined,
            }
          ),
        };
      }

      // 5b. Generate uv.lock for Container builds (required by the Dockerfile's uv sync step). Java
      //     builds with Maven inside its own Dockerfile — no uv.lock.
      if (renderConfig.buildType === 'Container' && !isJava) {
        log('Generating uv.lock for container build');
        try {
          execSync('uv lock', { cwd: agentDir, stdio: 'pipe' });
        } catch {
          // uv not installed or failed — add a note and continue; user can run manually
          context.exportNotes.push({
            category: 'uv.lock missing — run `uv lock` before deploying',
            message:
              `The container Dockerfile requires a uv.lock file. Run \`uv lock\` in ` +
              `app/${targetAgentName}/ before running \`agentcore deploy\`.`,
          });
        }
      }

      // 6. Write agent to agentcore.json
      log('Updating agentcore.json');
      try {
        await writeExportedAgentToProject(
          agentEnvSpec,
          context,
          credentialEntry,
          mcpCredentialEntries,
          gitCredentialEntries
        );
      } catch (err) {
        cleanupAgentDir();
        return { success: false as const, error: err instanceof Error ? err : new Error(String(err)) };
      }

      // 6c. Write MCP header credential values to .env.local for local development
      for (const { envVarName, value } of mcpCredentialEntries) {
        await setEnvVar(envVarName, value, context.configBaseDir);
      }

      // 6d. Write static connection discovery values (external gateway URL, browser/code-interpreter
      //     id) to .env.local so `agentcore dev` resolves them locally. At deploy the CDK connection
      //     wiring injects the same env vars onto the runtime.
      for (const [envVarName, value] of Object.entries(context.localEnvVars)) {
        await setEnvVar(envVarName, value, context.configBaseDir);
      }

      // 6e. Write generated IAM policy files (e.g. S3 skills) into the agent's code dir. They are
      //     referenced from AgentEnvSpec.additionalPolicies and attached to the role at deploy.
      for (const [fileName, policyDoc] of Object.entries(context.generatedPolicyFiles)) {
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, fileName), JSON.stringify(policyDoc, null, 2) + '\n');
      }

      // 7. Write EXPORT_NOTES.md
      log('Writing EXPORT_NOTES.md');
      writeExportNotes(context.exportNotes, harnessName, targetAgentName, agentDir, langConfig);

      // Record telemetry attrs after all work is done
      recorder.set({
        build_type: standardize(TelemetryBuildType, renderConfig.buildType ?? 'CodeZip'),
        // renderConfig.modelProvider is the CLI ModelProvider enum (e.g. 'LiteLLM'); standardize only
        // lowercases, so 'LiteLLM' -> 'litellm' would miss the telemetry token 'lite_llm'. Normalize
        // the one value whose lowercase != its telemetry token before standardizing.
        model_provider: standardize(
          TelemetryModelProvider,
          renderConfig.modelProvider === 'LiteLLM' ? 'lite_llm' : renderConfig.modelProvider
        ),
        has_memory: renderConfig.hasMemory,
        has_gateway: renderConfig.hasGateway,
        has_container: renderConfig.buildType === 'Container',
        has_execution_limits: !!renderConfig.hasExecutionLimits,
        notes_count: context.exportNotes.length,
      });

      return {
        success: true as const,
        agentName: targetAgentName,
        agentPath: agentDir,
        notesPath: join(agentDir, EXPORT_NOTES_FILENAME),
        notes: context.exportNotes,
      };
    }
  );
}

// ============================================================================
// Write agent entry to agentcore.json
// ============================================================================

/** Region for the --arn fetch: the current project's first deployment target. */
/**
 * Resolve the region used to fetch a harness by ARN, in priority order:
 *   1. the region embedded in the harness ARN (`arn:<p>:bedrock-agentcore:<region>:...`) — this is
 *      the region the harness actually lives in, so it is the most correct source;
 *   2. the first configured deployment target (agentcore/aws-targets.json);
 *   3. the AWS_REGION / AWS_DEFAULT_REGION environment variables.
 * Returns undefined only when none of these yield a region, so export-by-ARN no longer requires a
 * configured deployment target when the ARN (or the environment) already names a region.
 */
export async function resolveExportRegion(arn: string): Promise<string | undefined> {
  const arnRegion = regionFromHarnessArn(arn);
  if (arnRegion) return arnRegion;

  try {
    const targets = await new ConfigIO().readAWSDeploymentTargets();
    if (targets[0]?.region) return targets[0].region;
  } catch {
    // fall through to env
  }

  return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? undefined;
}

async function writeExportedAgentToProject(
  agentEnvSpec: AgentEnvSpec,
  context: ResolvedHarnessContext,
  credentialEntry: Credential | null,
  mcpCredentialEntries: { credential: Credential }[],
  gitCredentialEntries: Credential[] = []
): Promise<void> {
  const configIO = new ConfigIO({ baseDir: context.configBaseDir });
  const project = await configIO.readProjectSpec();

  if (project.runtimes.some(r => r.name === agentEnvSpec.name)) {
    throw new AgentAlreadyExistsError(agentEnvSpec.name);
  }

  project.runtimes.push(agentEnvSpec);

  if (credentialEntry && !project.credentials.some(c => c.name === credentialEntry.name)) {
    project.credentials.push(credentialEntry);
  }

  for (const { credential } of mcpCredentialEntries) {
    if (!project.credentials.some(c => c.name === credential.name)) {
      project.credentials.push(credential);
    }
  }

  // Git-skill API-key credential references (private repo clone auth).
  for (const credential of gitCredentialEntries) {
    if (!project.credentials.some(c => c.name === credential.name)) {
      project.credentials.push(credential);
    }
  }

  await configIO.writeProjectSpec(project);
}

// ============================================================================
// Dockerfile export notes
// ============================================================================

/**
 * Note emitted when a harness with a custom Dockerfile is exported.
 *
 * The harness Dockerfile describes an *execution environment* — the harness runtime overrides its
 * ENTRYPOINT/CMD and supplies the agent. An exported agent, by contrast, is the entrypoint and must
 * build/install its own deps and launch main.py. We cannot safely rewrite an arbitrary user
 * Dockerfile (custom base image, WORKDIR, USER, apt packages), so we preserve it as-is and tell the
 * user to append the agent build layer.
 */
export function buildCustomDockerfileNote(dockerfile: string, targetAgentName: string): ExportNote {
  return {
    category: CUSTOM_DOCKERFILE_NOTE_CATEGORY,
    message:
      `The harness used a custom Dockerfile ("${dockerfile}") that describes its execution ` +
      `environment. It has been copied to app/${targetAgentName}/${dockerfile} unchanged, but ` +
      `the exported agent will NOT run as-is: a harness Dockerfile has no dependency install, code copy, or ` +
      `startup command (the harness runtime supplied those). Add the Strands agent build layer to the end ` +
      `of app/${targetAgentName}/${dockerfile} before \`agentcore deploy\` ` +
      `(adjust if your base image is not Python 3.12+/uv, or already sets WORKDIR/USER):\n\n` +
      `  WORKDIR /app\n` +
      `  RUN pip install --no-cache-dir uv\n` +
      `  COPY pyproject.toml uv.lock ./\n` +
      `  RUN uv sync --frozen --no-dev --no-install-project\n` +
      `  COPY --chown=bedrock_agentcore:bedrock_agentcore . .\n` +
      `  RUN uv sync --frozen --no-dev\n` +
      `  USER bedrock_agentcore\n` +
      `  EXPOSE 8080 8000 9000\n` +
      `  CMD ["opentelemetry-instrument", "python", "-m", "main"]\n\n` +
      `Also ensure the build sets the runtime entrypoint to the generated main.py rather than ` +
      `the harness's overridden entrypoint.`,
  };
}

/** Note emitted when a harness references a dockerfile that does not exist on disk. */
export function buildMissingDockerfileNote(
  dockerfile: string,
  harnessName: string,
  targetAgentName: string
): ExportNote {
  return {
    category: `Dockerfile not found — create ${dockerfile} before deploying`,
    message:
      `The harness references dockerfile: "${dockerfile}" but no such file exists in ` +
      `app/${harnessName}/. Create a Dockerfile at app/${targetAgentName}/${dockerfile} ` +
      `before running \`agentcore deploy\`.`,
  };
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

/** Note emitted when local path-skill directories were copied into the generated agent dir. */
export function buildPathSkillsCopiedNote(paths: string[], targetAgentName: string, isJava = false): ExportNote {
  const isAre = paths.length === 1 ? 'directory was' : 'directories were';
  const dest = isJava
    ? `app/${targetAgentName}/src/main/resources/skills/, so ${paths.length === 1 ? 'it is' : 'they are'} packaged ` +
      `into the Spring Boot jar and loaded by the SkillsTool via classpath scanning`
    : `app/${targetAgentName}/ so the generated Dockerfile's \`COPY . .\` step bundles ` +
      `${paths.length === 1 ? 'it' : 'them'} into the image`;
  return {
    category: PATH_SKILLS_COPIED_NOTE_CATEGORY,
    message:
      `The following path-skill ${isAre} copied into ${dest} — no manual step required: ` +
      `${paths.map(p => `"${p}"`).join(', ')}.`,
  };
}

/**
 * Note emitted when a path skill could not be resolved to a local directory (absolute path, path
 * traversal, or not found under the harness dir). It is assumed to be provided by the base image.
 */
export function buildPathSkillsVerifyNote(paths: string[], targetAgentName: string): ExportNote {
  return {
    category: PATH_SKILLS_VERIFY_BASE_IMAGE_NOTE_CATEGORY,
    message:
      `The following path ${paths.length === 1 ? 'skill was' : 'skills were'} not found locally under the ` +
      `harness directory, so ${paths.length === 1 ? 'it was' : 'they were'} NOT copied into app/${targetAgentName}/: ` +
      `${paths.map(p => `"${p}"`).join(', ')}. The exported agent loads ${paths.length === 1 ? 'this path' : 'these paths'} ` +
      `at runtime — ensure ${paths.length === 1 ? 'it exists' : 'they exist'} on the container filesystem (e.g. installed ` +
      `in your base image or added via a Dockerfile COPY) before \`agentcore deploy\`.`,
  };
}

/** Note emitted when public git skill repos were shallow-cloned at export and staged into the jar. */
export function buildGitSkillsClonedNote(urls: string[], targetAgentName: string): ExportNote {
  return {
    category: GIT_SKILLS_CLONED_NOTE_CATEGORY,
    message:
      `The following public git skill ${urls.length === 1 ? 'repository was' : 'repositories were'} shallow-cloned at ` +
      `export and staged into app/${targetAgentName}/src/main/resources/skills/, so ${urls.length === 1 ? 'it is' : 'they are'} ` +
      `packaged into the Spring Boot jar and loaded by the SkillsTool — no git in the image, no runtime fetch: ` +
      `${urls.map(u => `"${u}"`).join(', ')}. Re-export to refresh the snapshot.`,
  };
}

/**
 * Note emitted when a public git skill repo could not be cloned at export (git missing, no network,
 * a private repo, or a bad URL/subdir). The export still succeeds; the skill is simply not staged.
 */
export function buildGitSkillsClonedFailedNote(urls: string[], targetAgentName: string): ExportNote {
  return {
    category: GIT_SKILLS_CLONE_FAILED_NOTE_CATEGORY,
    message:
      `The following git skill ${urls.length === 1 ? 'repository could' : 'repositories could'} not be cloned at export, ` +
      `so ${urls.length === 1 ? 'it was' : 'they were'} NOT staged into app/${targetAgentName}/: ` +
      `${urls.map(u => `"${u}"`).join(', ')}. Ensure \`git\` and network access are available and the URL is a public ` +
      `HTTPS repo, then re-export. (Private repos are not yet supported for Java export.)`,
  };
}

// ============================================================================
// Write EXPORT_NOTES.md
// ============================================================================

function readStrandsVersion(agentDir: string): string {
  try {
    const pyproject = readFileSync(join(agentDir, 'pyproject.toml'), 'utf8');
    const match = /strands-agents\s*(>=\s*[\d.]+)/.exec(pyproject);
    return match ? `strands-agents ${match[1]}` : 'strands-agents (version unknown)';
  } catch {
    return 'strands-agents (version unknown)';
  }
}

function writeExportNotes(
  notes: ExportNote[],
  harnessName: string,
  agentName: string,
  agentDir: string,
  langConfig: ExportLanguageConfig
): void {
  const today = new Date().toISOString().split('T')[0];
  // Python reports the resolved strands-agents version from pyproject.toml; Java has no equivalent
  // pin here (the Spring AI / agentcore versions live in pom.xml), so just name the framework.
  const frameworkLine =
    langConfig.targetLanguage === 'Java'
      ? `Framework: ${langConfig.sdkFramework} (Java, container-only)`
      : `Strands version: ${readStrandsVersion(agentDir)}`;
  const lines: string[] = [
    `# Export Notes — ${harnessName} → ${agentName}`,
    '',
    `Exported on: ${today}`,
    frameworkLine,
    `Source harness: agentcore/app/${harnessName}/harness.json`,
    `Generated agent: app/${agentName}/`,
    '',
  ];

  if (notes.length === 0) {
    lines.push('No manual steps required.');
  } else {
    lines.push('## Items requiring manual follow-up');
    for (const note of notes) {
      lines.push('');
      lines.push(`### ${note.category}`);
      lines.push(note.message);
    }
  }

  lines.push('');

  const outPath = join(agentDir, EXPORT_NOTES_FILENAME);
  writeFileSync(outPath, lines.join('\n'), 'utf8');
}

// ============================================================================
// Dockerfile stub for containerUri harnesses
// ============================================================================

function writeDockerfileStub(agentDir: string, containerUri: string): void {
  const content = [
    `# Base image from the source harness: ${containerUri}`,
    '# The generated Strands agent is layered on top. If the base image does not',
    '# include Python 3.12+ or uv, add install steps before the COPY/RUN below.',
    `FROM ${containerUri}`,
    '',
    'RUN pip install --no-cache-dir uv',
    '',
    'WORKDIR /app',
    '',
    'ARG UV_DEFAULT_INDEX',
    'ARG UV_INDEX',
    '',
    'ENV UV_SYSTEM_PYTHON=1 \\',
    '    UV_COMPILE_BYTECODE=1 \\',
    '    UV_NO_PROGRESS=1 \\',
    '    PYTHONUNBUFFERED=1 \\',
    '    DOCKER_CONTAINER=1 \\',
    '    UV_DEFAULT_INDEX=${UV_DEFAULT_INDEX} \\',
    '    UV_INDEX=${UV_INDEX} \\',
    '    PATH="/app/.venv/bin:$PATH"',
    '',
    'RUN useradd -m -u 1000 bedrock_agentcore',
    '',
    'COPY pyproject.toml uv.lock ./',
    'RUN uv sync --frozen --no-dev --no-install-project',
    '',
    'COPY --chown=bedrock_agentcore:bedrock_agentcore . .',
    'RUN uv sync --frozen --no-dev',
    '',
    'USER bedrock_agentcore',
    '',
    'EXPOSE 8080 8000 9000',
    '',
    'CMD ["opentelemetry-instrument", "python", "-m", "main"]',
    '',
  ].join('\n');

  writeFileSync(join(agentDir, 'Dockerfile'), content, 'utf8');
}
