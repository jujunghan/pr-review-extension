#!/usr/bin/env node
// Generate brand icons (16/48/128) for the Chrome extension using just
// node stdlib. Design: white card with a chubby purple 4-point sparkle
// at center-left plus two satellite sparkles. Anti-aliased rounded
// corners and polygon edges via 4× supersample.
//
// Run from anywhere:  node extension/icons/generate.mjs
// Outputs:  extension/icons/16.png  extension/icons/48.png  extension/icons/128.png

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));

// ----- PNG primitives -----
function crc32(buf) {
  let c, n;
  const table = crc32.table ||= (() => {
    const t = new Uint32Array(256);
    for (n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();
  c = 0xFFFFFFFF;
  for (n = 0; n < buf.length; n++) c = table[(c ^ buf[n]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}
function makePng(size, pixelFn) {
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowOff = y * (1 + size * 4);
    raw[rowOff] = 0;
    for (let x = 0; x < size; x++) {
      const off = rowOff + 1 + x * 4;
      const [r, g, b, a] = pixelFn(x, y);
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ----- Math helpers -----
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => v < 0 ? 0 : (v > 1 ? 1 : v);
const blend = (b, t, a) => [
  Math.round(lerp(b[0], t[0], a)),
  Math.round(lerp(b[1], t[1], a)),
  Math.round(lerp(b[2], t[2], a)),
  255,
];

// ----- Shapes -----
function inRoundedRectAlpha(x, y, size) {
  const r = size * 0.24;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const d = Math.hypot(x - cx, y - cy);
  if (d <= r - 0.5) return 1;
  if (d >= r + 0.5) return 0;
  return r + 0.5 - d;
}

// White card with a near-imperceptible vertical wash for depth.
function bgWhite(x, y, size) {
  const t = clamp01(y / (size - 1));
  return [Math.round(lerp(255, 250, t)), Math.round(lerp(255, 250, t)), Math.round(lerp(255, 254, t)), 255];
}

// Brand violet gradient that fills inside the sparkle (top→bottom).
function purpleInside(x, y, size) {
  const t = clamp01(y / (size - 1));
  return [
    Math.round(lerp(0x5B, 0x7C, t)),
    Math.round(lerp(0x5B, 0x3A, t)),
    Math.round(lerp(0xD6, 0xED, t)),
    255,
  ];
}

function sparkleVerts(cx, cy, height, width, inner) {
  return [
    [cx, cy - height],
    [cx + inner, cy - inner],
    [cx + width, cy],
    [cx + inner, cy + inner],
    [cx, cy + height],
    [cx - inner, cy + inner],
    [cx - width, cy],
    [cx - inner, cy - inner],
  ];
}

function pointInPolygon(x, y, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i][0], yi = verts[i][1];
    const xj = verts[j][0], yj = verts[j][1];
    const intersect = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polyCoverage(x, y, verts) {
  let hits = 0;
  for (let sy = 0; sy < 2; sy++) {
    for (let sx = 0; sx < 2; sx++) {
      const px = x + (sx + 0.5) / 2 - 0.5;
      const py = y + (sy + 0.5) / 2 - 0.5;
      if (pointInPolygon(px, py, verts)) hits++;
    }
  }
  return hits / 4;
}

function pixel(x, y, size) {
  const mask = inRoundedRectAlpha(x, y, size);
  if (mask <= 0) return [0, 0, 0, 0];
  const bg = bgWhite(x, y, size);
  // Main sparkle (center-left, slightly low) + two satellites
  const v1 = sparkleVerts(size * 0.42, size * 0.55, size * 0.32, size * 0.24, size * 0.09);
  const v2 = sparkleVerts(size * 0.78, size * 0.26, size * 0.13, size * 0.10, size * 0.035);
  const v3 = sparkleVerts(size * 0.82, size * 0.78, size * 0.09, size * 0.07, size * 0.025);
  const a = Math.max(polyCoverage(x, y, v1), polyCoverage(x, y, v2), polyCoverage(x, y, v3));
  let color = bg;
  if (a > 0) color = blend(bg, purpleInside(x, y, size), a);
  return mask < 1 ? [color[0], color[1], color[2], Math.round(mask * 255)] : color;
}

// ----- Emit -----
for (const size of [16, 48, 128]) {
  const buf = makePng(size, (x, y) => pixel(x, y, size));
  const out = join(here, `${size}.png`);
  writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes)`);
}
