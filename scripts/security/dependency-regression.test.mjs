import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rootRequire = createRequire(resolve(root, 'package.json'));
const webRequire = createRequire(resolve(root, 'apps/web/package.json'));
const apiRequire = createRequire(resolve(root, 'apps/api/package.json'));
const postcssRequire = createRequire(webRequire.resolve('postcss'));
const browserRequire = createRequire(webRequire.resolve('autoprefixer'));
const expressRequire = createRequire(
  createRequire(apiRequire.resolve('@nestjs/platform-express')).resolve('express'),
);
const configPath = createRequire(rootRequire.resolve('prisma/package.json')).resolve('@prisma/config');
const configRequire = createRequire(configPath);

// Resolve through real consumers, not a separate patched test-only dependency.
// Potential hangs run in bounded children; these are library proofs, not remote CRM exploits.
function checkInChild(modulePath, body) {
  const child = spawnSync(process.execPath, ['--max-old-space-size=128', '-e',
    `const assert = require('node:assert/strict'); const subject = require(${JSON.stringify(modulePath)}); ${body}`,
  ], { cwd: root, timeout: 10_000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr || child.stdout);
}

test('nanoid: zero-size custom generators terminate; normal IDs keep their length', () => {
  checkInChild(postcssRequire.resolve('nanoid'), `
    assert.equal(subject.customAlphabet('ab', 0)(), '');
    assert.equal(subject.customRandom('ab', 0, n => new Uint8Array(n))(), '');
    assert.match(subject.customAlphabet('ab', 12)(), /^[ab]{12}$/);
  `);
});

test('deepmerge: recursive records terminate without losing ordinary configuration values', () => {
  checkInChild(configRequire.resolve('deepmerge-ts'), `
    const left = { left: 1 }; left.self = left;
    const right = { right: 2 }; right.self = right;
    const result = subject.deepmerge(left, right);
    assert.equal(result.left, 1); assert.equal(result.right, 2);
    assert.equal(result.self, result);
    const callback = () => 'fixture';
    assert.deepEqual(subject.deepmerge({ migrations: { path: 'a' }, list: [1], callback },
      { migrations: { seed: 'b' }, list: [2] }),
      { migrations: { path: 'a', seed: 'b' }, list: [1, 2], callback });
  `);
});

test('deepmergeInto: the alternate recursive merge path also terminates', () => {
  checkInChild(configRequire.resolve('deepmerge-ts'), `
    const target = { left: 1 }; target.self = target;
    const source = { right: 2 }; source.self = source;
    subject.deepmergeInto(target, source);
    assert.equal(target.left, 1); assert.equal(target.right, 2);
    assert.equal(target.self, target);
  `);
});

test('browserslist: prototype-like custom statistics keys do not crash normal queries', () => {
  const browserslist = browserRequire('browserslist');
  const expected = browserslist('chrome 100');
  for (const key of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
    const stats = JSON.parse(`{"${key}":{"onekey":5},"chrome":{"100":50}}`);
    assert.deepEqual(browserslist('chrome 100', { stats }), expected);
  }
});

test('browserslist: distinct queries evict old cache entries while repeated queries remain correct', () => {
  checkInChild(browserRequire.resolve('browserslist'), `
    delete process.env.BROWSERSLIST_DISABLE_CACHE;
    const first = subject('chrome 100');
    assert.equal(subject('chrome 100'), first);
    for (let day = 1; day <= 600; day++) subject('since 1900-01-' + day);
    const refreshed = subject('chrome 100');
    assert.notEqual(refreshed, first);
    assert.deepEqual(refreshed, first);
  `);
});

test('qs: comma arrays respect the limit for plain, bracket and encoded bracket keys', () => {
  const qs = expressRequire('qs');
  const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true };
  for (const key of ['a', 'a[]', 'a%5B%5D']) {
    assert.throws(() => qs.parse(`${key}=1,2,3,4`, options), RangeError);
  }
  assert.deepEqual(qs.parse('a=1,2,3', options), { a: ['1', '2', '3'] });
  assert.deepEqual(qs.parse('page=2&filter[status]=active'), { page: '2', filter: { status: 'active' } });
});

test('qs: hostile constructor fields round-trip without calling non-functions', () => {
  const qs = expressRequire('qs');
  for (const options of [{ plainObjects: true }, { allowPrototypes: true }]) {
    for (const query of ['x[constructor][isBuffer]=y', 'x%5Bconstructor%5D%5BisBuffer%5D=y']) {
      assert.equal(qs.stringify(qs.parse(query, options)), 'x%5Bconstructor%5D%5BisBuffer%5D=y');
    }
  }
  assert.equal(qs.stringify({ file: Buffer.from('abc') }), 'file=abc');
});

test('Prisma 6 loads its default configuration with the resolved merger', async () => {
  const result = await rootRequire(configPath).loadConfigFromFile({ configRoot: root });
  assert.equal(result.error, undefined);
  assert.equal(result.resolvedPath, null);
  assert.ok(result.config);
});

for (const extension of ['ts', 'cjs']) {
  test(`Prisma 6 loads a real ${extension} configuration and resolves nested paths`, async () => {
    const configFile = `scripts/security/fixtures/prisma.config.${extension}`;
    const result = await rootRequire(configPath).loadConfigFromFile({ configRoot: root, configFile });
    assert.equal(result.error, undefined);
    assert.equal(result.config.schema, resolve(root, 'prisma/schema.prisma'));
    assert.equal(result.config.migrations.path, resolve(root, 'prisma/migrations'));
    assert.equal(result.config.migrations.seed, 'echo fixture-only');
  });
}

test('Prisma 6 preserves explicit missing-file errors', async () => {
  const result = await rootRequire(configPath).loadConfigFromFile({
    configRoot: root, configFile: 'scripts/security/fixtures/missing.config.ts',
  });
  assert.equal(result.error?._tag, 'ConfigFileNotFound');
});

test('Prisma 6 rejects unsupported configuration keys', async () => {
  const result = await rootRequire(configPath).loadConfigFromFile({
    configRoot: root, configFile: 'scripts/security/fixtures/invalid.config.cjs',
  });
  assert.equal(result.error?._tag, 'ConfigFileSyntaxError');
});
