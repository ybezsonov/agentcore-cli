/**
 * Snapshot tests for the Java assets and the Java Dockerfile. Update them with:
 *
 *   npm run test:snapshots:update
 */
import * as fs from 'fs';
import Handlebars from 'handlebars';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const ASSETS_DIR = path.resolve(__dirname, '..');
const JAVA_DIR = path.join(ASSETS_DIR, 'java');

function getAllFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(entry =>
      entry.isDirectory() ? getAllFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
    )
    .sort();
}

describe('Java assets', () => {
  const javaFiles = getAllFiles(JAVA_DIR).map(file => path.relative(ASSETS_DIR, file));

  it.each(javaFiles)('java/%s should match snapshot', file => {
    expect(fs.readFileSync(path.join(ASSETS_DIR, file), 'utf-8')).toMatchSnapshot();
  });
});

describe('Java Dockerfile rendering', () => {
  const template = Handlebars.compile(fs.readFileSync(path.join(ASSETS_DIR, 'container', 'java', 'Dockerfile'), 'utf-8'));

  it('uses pinned Maven and Corretto stages without network-fetched tooling', () => {
    const rendered = template({});
    expect(rendered).toMatchSnapshot('Dockerfile-java');
    expect(rendered).toContain('public.ecr.aws/docker/library/maven:3.9-amazoncorretto-21');
    expect(rendered).not.toContain('curl');
    expect(rendered).not.toContain('ADD https://');
    expect(rendered).not.toContain('OTEL_');
  });
});
