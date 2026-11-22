import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pub = new URL('../public/', import.meta.url);

// PNG width and height live at bytes 16-23 of the IHDR chunk.
function pngSize(name) {
  const buf = readFileSync(new URL(name, pub));
  assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${name} is a PNG`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test('Polly logo is a square, labelled SVG in the site colours', () => {
  const svg = readFileSync(new URL('parrot.svg', pub), 'utf8');
  assert.match(svg, /viewBox="0 0 120 120"/);
  assert.match(svg, /role="img" aria-label="Agent Parrot"/);
  for (const colour of ['#0E3B2A', '#12B76A', '#FFC531']) assert.ok(svg.includes(colour), `uses ${colour}`);
});

test('favicon and touch icon are the sizes the layout promises', () => {
  assert.deepEqual(pngSize('favicon-48.png'), [48, 48]);
  assert.deepEqual(pngSize('apple-touch-icon.png'), [180, 180]);
});
