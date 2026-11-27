// Downloads the dictionaries if missing (see data/datasets.csv):
// - CC-CEDICT (CC BY-SA 4.0, https://www.mdbg.net/chinese/dictionary?page=cc-cedict) for Chinese lookups.
// - ECDICT (MIT, https://github.com/skywind3000/ECDICT) at a pinned commit for English lookups, checked
//   against its registered checksum.
// - Britfone (MIT) and CMUdict (BSD-style) for British and American 音标, pinned and checked the same way.
// data/scripts/build-english.mjs then combines them into data/processed/english.tsv.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const force = process.argv.includes('--force');

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 4) throw new Error(`download failed: ${url}: ${err.message}`);
      console.log(`  retrying (${err.message})…`);
    }
  }
}

const CEDICT = 'data/cedict.txt';
if (existsSync(CEDICT) && !force) {
  console.log(`${CEDICT} already present`);
} else {
  console.log('downloading CC-CEDICT…');
  const gz = await download('https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz');
  mkdirSync('data', { recursive: true });
  writeFileSync(CEDICT, gunzipSync(gz));
  console.log(`saved ${CEDICT}`);
}

const ECDICT_COMMIT = '39cfb9672c0906b63569e0453c2e6abfb9ab182a';
const ECDICT_SHA256 = 'd1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc';
const ECDICT = 'data/raw/ecdict/ecdict.csv';
const ENGLISH = 'data/processed/english.tsv';
if (existsSync(ECDICT) && !force) {
  console.log(`${ECDICT} already present`);
} else {
  console.log('downloading ECDICT (66 MB)…');
  const base = `https://raw.githubusercontent.com/skywind3000/ECDICT/${ECDICT_COMMIT}`;
  const csv = await download(`${base}/ecdict.csv`);
  const sum = createHash('sha256').update(csv).digest('hex');
  if (sum !== ECDICT_SHA256) throw new Error(`ECDICT checksum mismatch (got ${sum}); not saving it`);
  mkdirSync('data/raw/ecdict', { recursive: true });
  writeFileSync(ECDICT, csv);
  writeFileSync('data/raw/ecdict/LICENSE', await download(`${base}/LICENSE`));
  console.log(`saved ${ECDICT}`);
}
// Pronunciation sources, pinned and checksum-checked like ECDICT.
const PRONUNCIATION = [
  {
    name: 'Britfone',
    dir: 'data/raw/britfone',
    base: 'https://raw.githubusercontent.com/JoseLlarena/Britfone/1062be14adc96c358f2087ac5449d72130c7a6f4',
    file: 'britfone.main.3.0.1.csv',
    sha256: '59f197e98520856d1cc88e380beb54e4314d8712efc4d588b6778819c502d920',
    extras: ['LICENSE.txt', 'britfone.symbols.3.0.1.txt'],
  },
  {
    name: 'CMUdict',
    dir: 'data/raw/cmudict',
    base: 'https://raw.githubusercontent.com/cmusphinx/cmudict/74790861f652b15e4ac49015a90074ad62a27690',
    file: 'cmudict.dict',
    sha256: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
    extras: ['LICENSE'],
  },
];
let rebuild = false;
for (const src of PRONUNCIATION) {
  const path = `${src.dir}/${src.file}`;
  if (existsSync(path) && !force) {
    console.log(`${path} already present`);
    continue;
  }
  console.log(`downloading ${src.name}…`);
  const data = await download(`${src.base}/${src.file}`);
  const sum = createHash('sha256').update(data).digest('hex');
  if (sum !== src.sha256) throw new Error(`${src.name} checksum mismatch (got ${sum}); not saving it`);
  mkdirSync(src.dir, { recursive: true });
  writeFileSync(path, data);
  for (const extra of src.extras) writeFileSync(`${src.dir}/${extra}`, await download(`${src.base}/${extra}`));
  console.log(`saved ${path}`);
  rebuild = true;
}

// Node runs the shared TypeScript pronunciation module directly; the flag only silences its notice about that.
if (rebuild || force || !existsSync(ENGLISH) || !readFileSync(ENGLISH, 'utf8').includes('ipa_us')) {
  execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'data/scripts/build-english.mjs'], { stdio: 'inherit' });
}
