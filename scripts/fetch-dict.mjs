// Downloads the CC-CEDICT dictionary (CC BY-SA 4.0, https://www.mdbg.net/chinese/dictionary?page=cc-cedict) if missing.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const OUT = 'data/cedict.txt';
const URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';

if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.log(`${OUT} already present`);
} else {
  console.log(`downloading CC-CEDICT…`);
  try {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = gunzipSync(Buffer.from(await res.arrayBuffer()));
    mkdirSync('data', { recursive: true });
    writeFileSync(OUT, text);
    console.log(`saved ${OUT}`);
  } catch (err) {
    console.warn(`⚠ could not download CC-CEDICT (${err.message}). Retry with: node scripts/fetch-dict.mjs`);
    // The app runs without it (no word meanings), so only a release build (--required) fails here.
    if (process.argv.includes('--required')) process.exit(1);
  }
}
