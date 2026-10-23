// Home-screen icons, drawn rather than imported: two PWAs from one codebase
// need two marks, and a build step beats hand-editing binaries.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((value, index) => Math.round(value + (b[index] - value) * t));

/**
 * A gabled roof over an open doorway — a house you can walk into, which is
 * about as close to "shared household" as a 192px square gets.
 */
function mark(bgTop, bgBottom, inkColor, { maskable = false } = {}) {
  const ink = inkColor;
  return (x, y, size) => {
    const u = x / size;
    const v = y / size;

    // Rounded square, or a full bleed for the maskable variant.
    if (!maskable) {
      const r = 0.22 * size;
      const dx = Math.max(r - x, 0, x - (size - r));
      const dy = Math.max(r - y, 0, y - (size - r));
      if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];
    }

    const background = mix(bgTop, bgBottom, v);

    // Geometry in a safe area so the maskable version survives cropping.
    const pad = maskable ? 0.28 : 0.2;
    const left = pad;
    const right = 1 - pad;
    const eaves = 0.5;
    const apex = pad + 0.03;
    const base = 1 - pad - 0.02;
    const stroke = 0.062;

    const inRoof = (() => {
      if (v < apex - stroke || v > eaves) return false;
      // Distance to each rafter, as a horizontal offset.
      const t = (v - apex) / (eaves - apex);
      const spanLeft = 0.5 - t * (0.5 - left);
      const spanRight = 0.5 + t * (right - 0.5);
      const near = Math.min(Math.abs(u - spanLeft), Math.abs(u - spanRight));
      // Horizontal half-width tapers to the wall's at the eaves so the two
      // strokes meet flush instead of leaving a nub.
      return t >= 0 && t <= 1 && near < stroke * (0.62 - 0.12 * t);
    })();

    const inWalls =
      v >= eaves - stroke * 0.25 &&
      v <= base &&
      ((Math.abs(u - left) < stroke * 0.5 && v <= base) ||
        (Math.abs(u - right) < stroke * 0.5 && v <= base) ||
        (Math.abs(v - base) < stroke * 0.5 && u >= left && u <= right));

    // Doorway: a gap punched out of the base line.
    const inDoor = v > base - 0.2 && Math.abs(u - 0.5) < 0.115;

    if ((inRoof || inWalls) && !inDoor) return [...ink, 255];
    return [...background, 255];
  };
}

// Two home-screen apps, so two colours: the phone (which holds both capture
// and the day) and the wall.
const CAPTURE = [[232, 131, 74], [196, 84, 40], [32, 18, 10]];
const DASHBOARD = [[90, 169, 196], [46, 108, 134], [12, 24, 30]];

const marks = {
  capture: mark(...CAPTURE),
  dashboard: mark(...DASHBOARD),
  "capture-maskable": mark(...CAPTURE, { maskable: true }),
  "dashboard-maskable": mark(...DASHBOARD, { maskable: true }),
};

const sizes = { capture: [180, 192, 512], dashboard: [180, 192, 512] };
mkdirSync(join(root, "public/icons"), { recursive: true });

for (const [name, pixel] of Object.entries(marks)) {
  const list = name.endsWith("-maskable") ? [512] : sizes[name];
  for (const size of list) {
    const file = join(root, `public/icons/${name}-${size}.png`);
    writeFileSync(file, png(size, pixel));
    console.log("wrote", file.replace(root + "/", ""));
  }
}
