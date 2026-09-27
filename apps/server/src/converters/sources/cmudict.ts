import { readLines } from '../input';

/**
 * The CMU Pronouncing Dictionary (issue #527): pronunciations of American
 * English in ARPAbet, one word a line — `abandon AH0 B AE1 N D AH0 N` —
 * https://github.com/cmusphinx/cmudict, BSD 2-Clause. WordNet has no
 * pronunciations; its adapter takes them from here, turned into IPA.
 */

const PHONES: Readonly<Record<string, string>> = {
  AA: 'ɑ',
  AE: 'æ',
  AH: 'ʌ',
  AO: 'ɔ',
  AW: 'aʊ',
  AY: 'aɪ',
  B: 'b',
  CH: 'tʃ',
  D: 'd',
  DH: 'ð',
  EH: 'ɛ',
  ER: 'ɝ',
  EY: 'eɪ',
  F: 'f',
  G: 'ɡ',
  HH: 'h',
  IH: 'ɪ',
  IY: 'i',
  JH: 'dʒ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  OW: 'oʊ',
  OY: 'ɔɪ',
  P: 'p',
  R: 'ɹ',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  UH: 'ʊ',
  UW: 'u',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ',
};

// the unstressed variants of two vowels
const UNSTRESSED: Readonly<Record<string, string>> = { AH: 'ə', ER: 'ɚ' };

// the consonant clusters a syllable of English may begin with: the stress
// mark stands before the syllable, so it moves back over its onset
const ONSETS = new Set(
  (
    'P_L P_R B_L B_R T_R D_R K_L K_R G_L G_R F_L F_R TH_R SH_R S_L S_M S_N S_P S_T S_K S_W T_W D_W K_W G_W ' +
    'P_Y B_Y F_Y V_Y M_Y K_Y HH_Y T_Y D_Y N_Y S_P_L S_P_R S_T_R S_K_R S_K_W S_P_Y S_T_Y S_K_Y'
  ).split(' '),
);

const isVowel = (phone: string): boolean => /\d$/.test(phone);

/** `AH0 B AE1 N D AH0 N` → `/əˈbændən/`; null for a phone the table does not know */
export const arpabetToIpa = (phones: string[]): string | null => {
  const vowels = phones.filter(isVowel).length;
  const out: string[] = [];
  // where each phone begins in `out`, to put a stress mark before an onset
  const starts: number[] = [];
  for (const [index, phone] of phones.entries()) {
    const stress = isVowel(phone) ? phone.slice(-1) : '';
    const base = stress ? phone.slice(0, -1) : phone;
    const symbol = (stress === '0' && UNSTRESSED[base]) || PHONES[base];
    if (!symbol) return null;
    starts.push(out.length);
    out.push(symbol);
    // a word of one syllable is written without the mark
    if ((stress === '1' || stress === '2') && vowels > 1) {
      let onset = index;
      while (onset > 0 && !isVowel(phones[onset - 1])) {
        const cluster = phones.slice(onset - 1, index).join('_');
        if (index - (onset - 1) > 1 && !ONSETS.has(cluster)) break;
        // a syllable does not begin with the sound of "sing"
        if (phones[onset - 1] === 'NG') break;
        onset -= 1;
      }
      out.splice(starts[onset], 0, stress === '1' ? 'ˈ' : 'ˌ');
      for (let later = onset; later < starts.length; later += 1) starts[later] += 1;
    }
  }
  return `/${out.join('')}/`;
};

/** The first pronunciation of every word of the file, by the word in lower case */
export const loadCmudict = async (file: string): Promise<Map<string, string>> => {
  const pronunciations = new Map<string, string>();
  for await (const line of readLines(file)) {
    // `;;;` opens a comment in the older releases, `#` closes a line in the newer
    const [word, ...phones] = line
      .replace(/\s+#.*$/, '')
      .trim()
      .split(/\s+/);
    // `read(2)` is a second pronunciation: the first one is kept
    if (!word || word.startsWith(';;;') || word.includes('(') || phones.length === 0) continue;
    const ipa = arpabetToIpa(phones);
    if (ipa && !pronunciations.has(word.toLowerCase())) pronunciations.set(word.toLowerCase(), ipa);
  }
  return pronunciations;
};
