import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { foldSearchText } from './text.js';

describe('foldSearchText', () => {
  it('toglie maiuscole e accenti', () => {
    assert.equal(foldSearchText('CAFFÈ Roma'), 'caffe roma');
    assert.equal(foldSearchText('perché'), 'perche');
    assert.equal(foldSearchText('Università'), 'universita');
  });

  it('non tocca ciò che non è una lettera accentata', () => {
    assert.equal(foldSearchText('100% _ a-b 12/34'), '100% _ a-b 12/34');
  });

  it('un testo già normalizzato resta uguale', () => {
    assert.equal(foldSearchText(foldSearchText('CAFFÈ')), 'caffe');
  });
});
