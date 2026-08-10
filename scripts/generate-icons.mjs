// Rasterises the Founder Brief mark (see app/icon.svg) into the PNG sizes that
// browsers and crawlers won't take as SVG. Re-run with `node scripts/generate-icons.mjs`
// if the mark ever changes; the SVG stays the source of truth.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Bars in the same 64x64 co-ordinate space as app/icon.svg: [x, y, w, h]
const GRID = 64;
const BARS = [
  [10, 14, 44, 7],
  [10, 28.5, 37.5, 7],
  [10, 43, 17, 7],
  [31.5, 43, 6.5, 7],
];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function render(size) {
  const scale = size / GRID;
  // Greyscale, 8-bit: one filter byte + one sample byte per pixel per row.
  const raw = Buffer.alloc(size * (size + 1), 0x00);
  for (const [bx, by, bw, bh] of BARS) {
    const x0 = Math.round(bx * scale);
    const x1 = Math.round((bx + bw) * scale);
    const y0 = Math.round(by * scale);
    const y1 = Math.round((by + bh) * scale);
    for (let y = y0; y < y1; y++) {
      raw.fill(0xff, y * (size + 1) + 1 + x0, y * (size + 1) + 1 + x1);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const app = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
for (const [name, size] of [
  ["icon1.png", 192],
  ["apple-icon.png", 180],
]) {
  writeFileSync(join(app, name), render(size));
  console.log(`wrote app/${name} (${size}x${size})`);
}
