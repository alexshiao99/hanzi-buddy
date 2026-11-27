import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arpabetToIpa, britfoneToIpa, cleanIpa, inflectIpa, modernizeIpa } from '../src/shared/pronunciation';

// Inputs are real lines from Britfone 3.0.1, CMUdict and ECDICT (see data/datasets.csv).

describe('britfoneToIpa', () => {
  it('moves the stress mark to the start of the syllable', () => {
    assert.equal(britfoneToIpa('b ˈɔː d ə'), 'ˈbɔːdə');
    assert.equal(britfoneToIpa('k ə m p j ˈuː t ə'), 'kəmˈpjuːtə');
    assert.equal(britfoneToIpa('ˌɪ n t ɹ ə d j ˈuː s'), 'ˌɪntrəˈdjuːs');
  });

  it('uses textbook symbols: r, e, ʌ', () => {
    assert.equal(britfoneToIpa('l ˈaɪ b ɹ ə ɹ i'), 'ˈlaɪbrəri');
    assert.equal(britfoneToIpa('ˈɛ k s t ɹ ə'), 'ˈekstrə');
    assert.equal(britfoneToIpa('k ˈɐ p'), 'kʌp');
  });

  it('leaves one-syllable words unmarked', () => {
    assert.equal(britfoneToIpa('s t ɹ ˈɒ ŋ'), 'strɒŋ');
  });
});

describe('arpabetToIpa (American)', () => {
  it('converts CMUdict codes to Oxford-style American IPA', () => {
    assert.equal(arpabetToIpa('B AO1 R D ER0'), 'ˈbɔːrdər');
    assert.equal(arpabetToIpa('K AH0 M P Y UW1 T ER0'), 'kəmˈpjuːtər');
    assert.equal(arpabetToIpa('HH AE1 P IY0'), 'ˈhæpi');
    assert.equal(arpabetToIpa('K AH0 N S T R AH1 K T'), 'kənˈstrʌkt');
  });

  it('keeps secondary stress before the main stress but not after it', () => {
    assert.equal(arpabetToIpa('IH2 N T R AH0 D UW1 S'), 'ˌɪntrəˈduːs');
    assert.equal(arpabetToIpa('L AY1 B R EH0 R IY2'), 'ˈlaɪbreri');
  });

  it('leaves one-syllable words unmarked', () => {
    assert.equal(arpabetToIpa('G OW1'), 'ɡoʊ');
    assert.equal(arpabetToIpa('HH AA1 T'), 'hɑːt');
  });
});

describe('modernizeIpa (ECDICT)', () => {
  it('turns the older notation into modern IPA', () => {
    assert.equal(modernizeIpa(cleanIpa('gou')), 'ɡəʊ');
    assert.equal(modernizeIpa('ai'), 'aɪ');
    assert.equal(modernizeIpa('bɒi'), 'bɔɪ');
    assert.equal(modernizeIpa('ˈbɒːdə'), 'ˈbɔːdə');
    assert.equal(modernizeIpa('ˈlimit'), 'ˈlɪmɪt');
    assert.equal(modernizeIpa('ˈbaundri'), 'ˈbaʊndri');
    assert.equal(modernizeIpa('bəːd'), 'bɜːd');
  });

  it('keeps the final i of happy and long vowels', () => {
    assert.equal(modernizeIpa('ˈhæpi'), 'ˈhæpi');
    assert.equal(modernizeIpa('θriː'), 'θriː');
  });

  it('reads ECDICT secondary stress written as . or ,', () => {
    assert.equal(cleanIpa('.intrəˈdjuːs'), 'ˌintrəˈdjuːs');
  });
});

describe('inflectIpa', () => {
  it('adds regular endings by the last sound', () => {
    assert.equal(inflectIpa('bʊk', 's'), 'bʊks');
    assert.equal(inflectIpa('wɒtʃ', 's'), 'wɒtʃɪz');
    assert.equal(inflectIpa('ˈæpl', 's'), 'ˈæplz');
    assert.equal(inflectIpa('wɒnt', 'p'), 'wɒntɪd');
    assert.equal(inflectIpa('stɒp', 'p'), 'stɒpt');
    assert.equal(inflectIpa('ˈbɒrəʊ', 'p'), 'ˈbɒrəʊd');
    assert.equal(inflectIpa('bɪɡ', 'r'), 'bɪɡə');
    assert.equal(inflectIpa('bɪɡ', 'r', 'us'), 'bɪɡər');
  });
});

describe('joinWithStress', () => {
  it('drops secondary stress after the main stress, from any source', () => {
    assert.equal(britfoneToIpa('b ˈɒ ɹ ˌəʊ d'), 'ˈbɒrəʊd');
  });
});

describe('arpabetToIpa weak stress', () => {
  it('keeps full vowels after the main stress, unmarked', () => {
    assert.equal(arpabetToIpa('HH OW1 M W ER2 K'), 'ˈhoʊmwɜːrk');
  });
});
