import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { escapeLike } from './sql.js';

describe('escapeLike', () => {
  it('antepone la barra rovesciata a % e _', () => {
    assert.equal(escapeLike('100%_a'), '100\\%\\_a');
  });

  it('raddoppia la barra rovesciata', () => {
    assert.equal(escapeLike('a\\b'), 'a\\\\b');
  });

  it('lascia invariato un testo senza caratteri speciali', () => {
    assert.equal(escapeLike('abc'), 'abc');
  });
});
