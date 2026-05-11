import { readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const root = 'public/models-pack';
const packs = ['mini-market', 'food-kit'];

function toName(filename) {
  return filename
    .replace('.glb', '')
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function categoryGuess(pack, name) {
  if (pack === 'mini-market') {
    if (/shelf|display|column/i.test(name)) return 'shelving';
    if (/freezer/i.test(name)) return 'refrigeration';
    if (/cash|register/i.test(name)) return 'checkout';
    if (/wall|fence|floor/i.test(name)) return 'storage';
    if (/cart|basket/i.test(name)) return 'storage';
    if (/character/i.test(name)) return 'decor';
    return 'storage';
  }
  // food-kit
  if (/burger|hot|pizza|sandwich|kebab|taco|noodle|rice|sushi/i.test(name)) return 'food';
  if (/bottle|can|cup|cocktail/i.test(name)) return 'food';
  if (/apple|banana|orange|cherry|strawberry|pear|peach|grape|lemon|lime|melon|pineapple/i.test(name)) return 'food';
  if (/carrot|broccoli|tomato|onion|cabbage|beet|pepper|garlic|corn|cucumber|potato|lettuce|mushroom|pumpkin/i.test(name)) return 'food';
  if (/bread|cake|donut|cookie|muffin|cupcake|pretzel|cheese/i.test(name)) return 'food';
  if (/meat|bacon|fish|sausage|chicken|egg|shrimp|salmon/i.test(name)) return 'food';
  return 'food';
}

const items = [];
for (const pack of packs) {
  const dir = join(root, pack);
  const files = readdirSync(dir).filter(f => f.endsWith('.glb'));
  for (const f of files) {
    items.push({
      id: `kenney-${pack.replace('-', '')}-${f.replace('.glb', '')}`,
      pack,
      name: toName(f),
      filename: f,
      glb: `/models-pack/${pack}/${f}`,
      category: categoryGuess(pack, f),
    });
  }
}

writeFileSync('public/models-pack/manifest.json', JSON.stringify(items, null, 2));
console.log(`Manifest: ${items.length} items`);
console.log(`Mini Market: ${items.filter(i => i.pack === 'mini-market').length}`);
console.log(`Food Kit: ${items.filter(i => i.pack === 'food-kit').length}`);
