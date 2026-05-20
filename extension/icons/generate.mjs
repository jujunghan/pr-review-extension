#!/usr/bin/env node
// Generate brand icons (16/48/128) for the Chrome extension using just
// node stdlib. Produces a brand-purple rounded square with a white
// 4-point sparkle ('✨'-flavoured) at the centre. No image library
// dependency.
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
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowOff = y * (1 + size * 4);
    raw[rowOff] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const off = rowOff + 1 + x * 4;
      const [r, g, b, a] = pixelFn(x, y);
      raw[off]     = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
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

// ----- Drawing -----
// Background: brand-purple linear gradient (top-left → bottom-right).
function bgColor(x, y, size) {
  const t = (x + y) / (2 * (size - 1)); // 0..1 diagonal
  // #5b5bd6 → #4f46e5
  const r = Math.round(91 + (79 - 91) * t);
  const g = Math.round(91 + (70 - 91) * t);
  const b = Math.round(214 + (229 - 214) * t);
  return [r, g, b, 255];
}

// Rounded square mask: 1 inside, 0 outside.
function inRounded(x, y, size) {
  const r = Math.max(2, Math.round(size * 0.18));
  if (x >= r && x < size - r) return true;
  if (y >= r && y < size - r) return true;
  // corners
  const corners = [
    [r, r], [size - 1 - r, r], [r, size - 1 - r], [size - 1 - r, size - 1 - r],
  ];
  for (const [cx, cy] of corners) {
    const ax = x <= r ? r : (x >= size - r ? size - 1 - r : null);
    const ay = y <= r ? r : (y >= size - r ? size - 1 - r : null);
    if (ax === cx && ay === cy) {
      const dx = x - cx, dy = y - cy;
      return dx * dx + dy * dy <= r * r;
    }
  }
  return false;
}

// 4-point sparkle: two crossed thin diamonds (axis-aligned + a smaller diagonal).
function inSparkle(x, y, size) {
  const cx = size / 2 - 0.5;
  const cy = size / 2 - 0.5;
  const arm = size * 0.34;   // outer span
  const waist = Math.max(1, size * 0.07); // half-thickness at centre

  // axis-aligned diamond: |x|/arm + |y|/waist <= 1  combined with  |y|/arm + |x|/waist <= 1
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  const inHorz = dx / arm + dy / waist <= 1;
  const inVert = dy / arm + dx / waist <= 1;
  if (inHorz || inVert) return true;

  // small diagonal sparkle dots in 4 quadrants
  const off = size * 0.34;
  const r = Math.max(0.7, size * 0.05);
  const dots = [
    [cx - off, cy - off], [cx + off, cy - off],
    [cx - off, cy + off], [cx + off, cy + off],
  ];
  for (const [px, py] of dots) {
    const d2 = (x - px) * (x - px) + (y - py) * (y - py);
    if (d2 <= r * r) return true;
  }
  return false;
}

function pixel(x, y, size) {
  if (!inRounded(x, y, size)) return [0, 0, 0, 0];
  if (inSparkle(x, y, size)) return [255, 255, 255, 255];
  return bgColor(x, y, size);
}

// ----- Emit -----
for (const size of [16, 48, 128]) {
  const buf = makePng(size, (x, y) => pixel(x, y, size));
  const out = join(here, `${size}.png`);
  writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes)`);
}
