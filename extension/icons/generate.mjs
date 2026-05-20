#!/usr/bin/env node
// Generate brand icons (16/48/128) for the Chrome extension using just
// node stdlib. Modernized design: deep violet → indigo gradient with a
// soft inner radial highlight, a crisp 5-point star at the center, and
// supersampled anti-aliasing for smoother edges.
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
  ihdr[9] = 6; // RGBA
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
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function blendOver(base, top, alpha) {
  return [
    Math.round(lerp(base[0], top[0], alpha)),
    Math.round(lerp(base[1], top[1], alpha)),
    Math.round(lerp(base[2], top[2], alpha)),
    255,
  ];
}

// ----- Shapes -----
function inRoundedRectAlpha(x, y, size) {
  // Anti-aliased rounded square coverage: distance from corner radius.
  const r = size * 0.24;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= r - 0.5) return 1;
  if (dist >= r + 0.5) return 0;
  return r + 0.5 - dist;
}

function bgGradient(x, y, size) {
  // Diagonal violet → indigo with subtle radial top-left highlight.
  const t = clamp01((x + y) / (2 * (size - 1)));
  // Deep indigo 4F46E5 → vivid violet 7C3AED → midnight 312E81
  let r, g, b;
  if (t < 0.5) {
    const u = t / 0.5;
    r = lerp(0x4F, 0x7C, u);
    g = lerp(0x46, 0x3A, u);
    b = lerp(0xE5, 0xED, u);
  } else {
    const u = (t - 0.5) / 0.5;
    r = lerp(0x7C, 0x31, u);
    g = lerp(0x3A, 0x2E, u);
    b = lerp(0xED, 0x81, u);
  }
  // Radial top-left lighten so the surface feels lit
  const cx = size * 0.28;
  const cy = size * 0.24;
  const d = Math.hypot(x - cx, y - cy) / size;
  const light = Math.max(0, 1 - d * 1.8) * 0.22;
  return [
    Math.round(Math.min(255, r + light * 255)),
    Math.round(Math.min(255, g + light * 255)),
    Math.round(Math.min(255, b + light * 255)),
    255,
  ];
}

// 5-point star polygon coverage (with optional fractional AA via super-sample)
function makeStarPolygon(size) {
  const cx = size / 2;
  const cy = size / 2 + size * 0.02;
  const outerR = size * 0.30;
  const innerR = outerR * 0.40;
  const verts = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI / 5);
    const r = i % 2 === 0 ? outerR : innerR;
    verts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
  }
  return verts;
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

function starCoverage(x, y, verts) {
  // 4x supersample for soft star edges
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

function pixel(x, y, size, starVerts) {
  const mask = inRoundedRectAlpha(x, y, size);
  if (mask <= 0) return [0, 0, 0, 0];
  const bg = bgGradient(x, y, size);
  const starAlpha = starCoverage(x, y, starVerts);
  let color = bg;
  if (starAlpha > 0) {
    // White star with a very faint warm tint near the top for premium feel
    const cx = size / 2, cy = size / 2;
    const dy = (y - cy) / size;
    const tint = dy < 0 ? clamp01(-dy * 1.5) : 0;
    const star = [255, 255 - tint * 8, 255 - tint * 24, 255];
    color = blendOver(bg, star, starAlpha);
  }
  if (mask < 1) {
    return [color[0], color[1], color[2], Math.round(mask * 255)];
  }
  return color;
}

// ----- Emit -----
for (const size of [16, 48, 128]) {
  const verts = makeStarPolygon(size);
  const buf = makePng(size, (x, y) => pixel(x, y, size, verts));
  const out = join(here, `${size}.png`);
  writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes)`);
}
