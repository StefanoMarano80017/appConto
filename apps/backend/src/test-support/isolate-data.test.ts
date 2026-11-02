import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

test('il processo di test usa una cartella dati temporanea, non quella del repository', async () => {
  const { config } = await import('../config.js');
  const repoRoot = path.resolve(import.meta.dirname, '../../../..');

  assert.ok(isInside(config.dataRoot, os.tmpdir()), `dataRoot fuori da tmpdir: ${config.dataRoot}`);
  assert.ok(isInside(config.databaseFile, os.tmpdir()), `databaseFile fuori da tmpdir: ${config.databaseFile}`);
  assert.ok(!isInside(config.dataRoot, repoRoot), 'dataRoot dentro il repository');
  assert.ok(!isInside(config.databaseFile, repoRoot), 'databaseFile dentro il repository');
});
