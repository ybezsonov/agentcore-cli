import Handlebars from 'handlebars';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Register custom Handlebars helpers
Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
Handlebars.registerHelper('includes', (array: unknown[], value: unknown) => {
  if (!Array.isArray(array)) return false;
  return array.includes(value);
});
Handlebars.registerHelper('snakeCase', (str: string) => {
  return str.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
});
// Converts a mount path to a Python identifier slug, e.g. /mnt/my-tools -> mnt_my_tools
Handlebars.registerHelper('pathSlug', (str: string) => {
  return str
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/^_+/, '')
    .replace(/_+/g, '_')
    .toLowerCase();
});
// Emits a value as JSON-safe Python literal (string or dict).
// Wraps result in Handlebars.SafeString to prevent double-escaping.
Handlebars.registerHelper('safeJson', (value: unknown) => {
  return new Handlebars.SafeString(JSON.stringify(value));
});
// Emits a value as a Python string literal containing its JSON text, for use with json.loads().
// Unlike safeJson, this is safe for arbitrary objects: JSON booleans/null inside the value stay
// inside the string (true/false/null) and are parsed by json.loads at runtime, rather than being
// inlined as bare Python tokens (which would be NameErrors). Double-encoding guarantees a valid
// Python string literal because JSON's escape set is a subset of Python's.
Handlebars.registerHelper('pyJsonStr', (value: unknown) => {
  return new Handlebars.SafeString(JSON.stringify(JSON.stringify(value)));
});
// Escapes triple-double-quotes so the value is safe to embed in a Python """...""" string.
Handlebars.registerHelper('escapePyStr', (value: unknown) => {
  const s = typeof value === 'string' ? value : '';
  return new Handlebars.SafeString(s.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"'));
});
// Emits a Spring `${MODEL_ID:<id>}` property reference where <id> is the given model id, or the
// fallback when it is empty/absent. Built in a helper (not inline in the template) because a literal
// `${MODEL_ID:{{modelId}}}` would put a `}}}` next to the mustache close, which Handlebars misparses
// as a triple/unescaped close. Returns a SafeString; use it inside a `{{{ }}}` triple-stache.
Handlebars.registerHelper('modelRef', (modelId: unknown, fallback: unknown) => {
  const id = typeof modelId === 'string' && modelId.length > 0 ? modelId : String(fallback);
  return new Handlebars.SafeString('${MODEL_ID:' + id + '}');
});
// Emits a Spring `${<ENV_VAR>:<fallback>}` property reference for a runtime-injected env var with a
// literal fallback. Like modelRef, this is a helper (not inline) because `${{{envVar}}:...}` would put
// `{{{` / `}}}` next to the mustache and Handlebars would misparse it as a triple-stache. Returns a
// SafeString; use inside a `{{{ }}}` triple-stache.
Handlebars.registerHelper('envRef', (envVarName: unknown, fallback: unknown) => {
  return new Handlebars.SafeString('${' + String(envVarName) + ':' + String(fallback) + '}');
});
// Escapes a string for use as a single-line Java .properties VALUE: backslash first, then the
// whitespace control chars to their \n/\r/\t/\f escapes so a multi-line value (e.g. an exported
// harness system prompt) stays on one line and round-trips through java.util.Properties. Returns a
// SafeString so Handlebars does not HTML-escape prompt characters like & < > " '.
Handlebars.registerHelper('escapeProps', (value: unknown) => {
  const s = typeof value === 'string' ? value : '';
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\f/g, '\\f');
  return new Handlebars.SafeString(escaped);
});
Handlebars.registerHelper('some', (array: unknown[], key: string) => {
  if (!Array.isArray(array)) return false;
  return array.some(
    item => item !== null && typeof item === 'object' && key in item && !!(item as Record<string, unknown>)[key]
  );
});
Handlebars.registerHelper('or', (...args: unknown[]) => {
  // Last arg is the Handlebars options object — exclude it
  return args.slice(0, -1).some(Boolean);
});

/**
 * Renames template files to their actual names.
 * e.g., "gitignore.template" -> ".gitignore"
 */
function resolveTemplateName(filename: string): string {
  if (filename === 'gitignore.template') return '.gitignore';
  if (filename === 'npmignore.template') return '.npmignore';
  if (filename === 'dockerignore.template') return '.dockerignore';
  return filename;
}

/**
 * Recursively copies a directory from src to dest.
 * Handles template file renaming (e.g., gitignore.template -> .gitignore).
 */
export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destName = resolveTemplateName(entry.name);
    const destPath = path.join(dest, destName);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Recursively copies a directory, rendering Handlebars templates.
 */
export async function copyAndRenderDir<T extends object>(
  src: string,
  dest: string,
  data: T,
  options?: { exclude?: Set<string> }
): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const destName = resolveTemplateName(entry.name);
    if (options?.exclude?.has(destName)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, destName);

    if (entry.isDirectory()) {
      await copyAndRenderDir(srcPath, destPath, data);
    } else {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      const content = await fs.readFile(srcPath, 'utf-8');
      const template = Handlebars.compile(content);
      const rendered = template(data);
      await fs.writeFile(destPath, rendered, 'utf-8');
    }
  }
}
