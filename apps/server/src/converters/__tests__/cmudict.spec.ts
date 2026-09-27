import { describe, expect, it } from '@jest/globals';
import * as path from 'node:path';
import { arpabetToIpa, loadCmudict } from '../sources/cmudict';

// The pronunciations WordNet lacks, from the CMU Pronouncing Dictionary (issue #527)
describe('arpabetToIpa', () => {
  const ipa = (phones: string): string | null => arpabetToIpa(phones.split(' '));

  it('writes a word of one syllable without a stress mark', () => {
    expect(ipa('L AE1 M P')).toBe('/læmp/');
    expect(ipa('S T R IY1 T')).toBe('/stɹit/');
  });

  it('puts the stress before the syllable, its onset included', () => {
    expect(ipa('AH0 B AE1 N D AH0 N')).toBe('/əˈbændən/');
    expect(ipa('D IH1 K SH AH0 N EH2 R IY0')).toBe('/ˈdɪkʃəˌnɛɹi/');
    // "str" begins a syllable, "ks" does not: the mark stops after the k
    expect(ipa('IH0 K S T R IY1 M')).toBe('/ɪkˈstɹim/');
    expect(ipa('S IH1 NG IH0 NG')).toBe('/ˈsɪŋɪŋ/');
  });

  it('reduces the unstressed vowels it has a symbol for', () => {
    expect(ipa('B AH1 T ER0')).toBe('/ˈbʌtɚ/');
    expect(ipa('B ER1 D')).toBe('/bɝd/');
  });

  it('is null for a phone it does not know', () => {
    expect(ipa('L XX1 M')).toBeNull();
  });
});

describe('loadCmudict', () => {
  it('keeps the first pronunciation of a word and skips comments', async () => {
    const pronunciations = await loadCmudict(path.join(__dirname, 'fixtures/cmudict.dict'));

    expect(pronunciations.get('run')).toBe('/ɹʌn/');
    expect(pronunciations.get('walk')).toBe('/wɔk/');
    expect(pronunciations.get('engineering')).toBe('/ˌɛndʒəˈnɪɹɪŋ/');
    expect(pronunciations.has(';;;')).toBe(false);
    expect(pronunciations.size).toBe(6);
  });
});
