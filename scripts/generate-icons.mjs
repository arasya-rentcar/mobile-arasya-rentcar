// Generates the simple brand icons (white "A" on Arasya blue) without any dependencies.
// Usage: node scripts/generate-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BLUE = [0x04, 0x6b, 0xd2, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixel(x + 0.5, y + 0.5);
      raw.set(p, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// Letter "A" drawn with thick strokes in a unit box scaled by `scale` (fraction of canvas).
function isA(x, y, size, scale) {
  const s = size * scale;
  const ox = (size - s) / 2, oy = (size - s) / 2;
  const u = (x - ox) / s, v = (y - oy) / s;
  const w = 0.075;
  return (
    distToSegment(u, v, 0.5, 0.08, 0.14, 0.92) < w ||
    distToSegment(u, v, 0.5, 0.08, 0.86, 0.92) < w ||
    distToSegment(u, v, 0.3, 0.62, 0.7, 0.62) < w * 0.85
  );
}
function roundedSquare(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

const out = (name, buf) => writeFileSync(new URL(`../assets/images/${name}`, import.meta.url), buf);
out('icon.png', png(1024, (x, y) => (isA(x, y, 1024, 0.6) ? WHITE : BLUE)));
out('android-icon-foreground.png', png(1024, (x, y) => (isA(x, y, 1024, 0.42) ? WHITE : CLEAR)));
out('android-icon-monochrome.png', png(1024, (x, y) => (isA(x, y, 1024, 0.42) ? WHITE : CLEAR)));
out('splash-icon.png', png(512, (x, y) => (isA(x, y, 512, 0.8) ? WHITE : CLEAR)));
out('notification-icon.png', png(96, (x, y) => (isA(x, y, 96, 0.8) ? WHITE : CLEAR)));
out('favicon.png', png(48, (x, y) => (!roundedSquare(x, y, 48, 10) ? CLEAR : isA(x, y, 48, 0.66) ? WHITE : BLUE)));
console.log('Icons written to assets/images');
