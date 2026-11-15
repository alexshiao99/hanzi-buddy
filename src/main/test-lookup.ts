// Quick CLI check of the lookup pipeline: node dist/test-lookup.js 我喜欢学中文
import path from 'node:path';
import { Dictionary, translate } from './lookup';

async function main(): Promise<void> {
  const text = process.argv.slice(2).join(' ') || '我喜欢学中文';
  const t0 = Date.now();
  const dict = new Dictionary(path.join(__dirname, '..', 'data', 'cedict.txt'));
  console.log(`dictionary loaded in ${Date.now() - t0}ms`);

  const result = dict.lookup(text);
  console.log(`\n${result.text}\n${result.pinyin}\n`);
  for (const w of result.words) {
    console.log(`  ${w.hanzi}\t${w.pinyin}\t${w.defs.slice(0, 3).join('; ')}`);
  }
  console.log(`\ntranslation: ${(await translate(text)) ?? '(unavailable)'}`);
}

void main();
