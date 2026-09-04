import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

// Change only this value when you want a different mood.
// You can also override it without editing the file:
// MONEYBOOK_ICON_THEME=spring npm run build
const DEFAULT_THEME = "cozy";
const ICON_THEME = process.env.MONEYBOOK_ICON_THEME || DEFAULT_THEME;

const THEMES = {
  cozy: {
    background: "#FFF7E8",
    panel: "#FFFDF7",
    border: "#B9E0D0",
    roof: "#79C7B6",
    roofDark: "#4A9B8D",
    navy: "#233D5B",
    navySoft: "#35597A",
    coral: "#FF8778",
    coralDark: "#E66E63",
    gold: "#F2BF4D",
    goldDark: "#D89A25",
    green: "#95C989",
    skin: "#FFD6B8",
    hairLeft: "#7A4A38",
    hairRight: "#25374E",
    shirtLeft: "#F58F7B",
    shirtRight: "#79C9B5",
    white: "#FFFDF7",
    page: "#FFF3D5",
    shadow: "#18354A"
  },
  spring: {
    background: "#F8FFF8",
    panel: "#FFFDF8",
    border: "#BDE8CC",
    roof: "#83D4AC",
    roofDark: "#55A984",
    navy: "#375A64",
    navySoft: "#527783",
    coral: "#FFA0AA",
    coralDark: "#E77F8B",
    gold: "#F5CF67",
    goldDark: "#D7AA39",
    green: "#A9D990",
    skin: "#FFDABF",
    hairLeft: "#815545",
    hairRight: "#36505A",
    shirtLeft: "#FF9DAD",
    shirtRight: "#8ED6B3",
    white: "#FFFFFF",
    page: "#FFF7DC",
    shadow: "#33555D"
  },
  peach: {
    background: "#FFF6F1",
    panel: "#FFFCF9",
    border: "#F4C7BA",
    roof: "#EFA995",
    roofDark: "#CF806D",
    navy: "#4B4054",
    navySoft: "#6A5C73",
    coral: "#FF7F73",
    coralDark: "#DA625A",
    gold: "#F3C55A",
    goldDark: "#D7A232",
    green: "#A9C994",
    skin: "#FFD5BC",
    hairLeft: "#795040",
    hairRight: "#3D394A",
    shirtLeft: "#F38F84",
    shirtRight: "#B5C997",
    white: "#FFFDFB",
    page: "#FFF0DA",
    shadow: "#493B4C"
  },
  blue: {
    background: "#F3FAFF",
    panel: "#FCFEFF",
    border: "#BDDDF1",
    roof: "#80C8E7",
    roofDark: "#4A9FC3",
    navy: "#244767",
    navySoft: "#3C6485",
    coral: "#FF8B8E",
    coralDark: "#DD6D71",
    gold: "#F1C45E",
    goldDark: "#D6A33A",
    green: "#91CDB6",
    skin: "#FFD7BD",
    hairLeft: "#735043",
    hairRight: "#233C58",
    shirtLeft: "#F79596",
    shirtRight: "#7AC7DD",
    white: "#FFFFFF",
    page: "#FFF5DD",
    shadow: "#1E405C"
  },
  night: {
    background: "#1D2940",
    panel: "#27354F",
    border: "#607CA5",
    roof: "#6FB6AA",
    roofDark: "#4B8E86",
    navy: "#152238",
    navySoft: "#304764",
    coral: "#FF8D91",
    coralDark: "#E16D73",
    gold: "#F2C969",
    goldDark: "#D6A644",
    green: "#7FB997",
    skin: "#F4C9AF",
    hairLeft: "#68463B",
    hairRight: "#18263B",
    shirtLeft: "#D97C80",
    shirtRight: "#63A99E",
    white: "#F9F4EA",
    page: "#EEDFBF",
    shadow: "#0D1626"
  }
};

const OUTPUTS = [
  ["public/apple-touch-icon.png", 180, false],
  ["public/icon-192.png", 192, false],
  ["public/icon-512.png", 512, false],
  ["public/maskable-512.png", 512, true]
];

const theme = THEMES[ICON_THEME];
if (!theme) {
  throw new Error(
    `Unknown MONEYBOOK_ICON_THEME: ${ICON_THEME}. Choose one of: ${Object.keys(THEMES).join(", ")}`
  );
}

function hex(value, alpha = 255) {
  const clean = value.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
    alpha
  ];
}

const C = Object.fromEntries(
  Object.entries(theme).map(([key, value]) => [key, hex(value)])
);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function blendPixel(buffer, size, x, y, rgba) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const index = (y * size + x) * 4;
  const sa = rgba[3] / 255;
  if (sa >= 0.999) {
    buffer[index] = rgba[0];
    buffer[index + 1] = rgba[1];
    buffer[index + 2] = rgba[2];
    buffer[index + 3] = rgba[3];
    return;
  }
  const da = buffer[index + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  buffer[index] = Math.round((rgba[0] * sa + buffer[index] * da * (1 - sa)) / outA);
  buffer[index + 1] = Math.round((rgba[1] * sa + buffer[index + 1] * da * (1 - sa)) / outA);
  buffer[index + 2] = Math.round((rgba[2] * sa + buffer[index + 2] * da * (1 - sa)) / outA);
  buffer[index + 3] = Math.round(outA * 255);
}

function fillRect(buffer, size, left, top, right, bottom, rgba) {
  const x0 = Math.max(0, Math.floor(left));
  const y0 = Math.max(0, Math.floor(top));
  const x1 = Math.min(size, Math.ceil(right));
  const y1 = Math.min(size, Math.ceil(bottom));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) blendPixel(buffer, size, x, y, rgba);
  }
}

function fillCircle(buffer, size, cx, cy, radius, rgba) {
  const r2 = radius * radius;
  const left = Math.max(0, Math.floor(cx - radius));
  const right = Math.min(size - 1, Math.ceil(cx + radius));
  const top = Math.max(0, Math.floor(cy - radius));
  const bottom = Math.min(size - 1, Math.ceil(cy + radius));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) blendPixel(buffer, size, x, y, rgba);
    }
  }
}

function fillEllipse(buffer, size, cx, cy, rx, ry, rgba) {
  const left = Math.max(0, Math.floor(cx - rx));
  const right = Math.min(size - 1, Math.ceil(cx + rx));
  const top = Math.max(0, Math.floor(cy - ry));
  const bottom = Math.min(size - 1, Math.ceil(cy + ry));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) blendPixel(buffer, size, x, y, rgba);
    }
  }
}

function fillRoundedRect(buffer, size, left, top, right, bottom, radius, rgba) {
  const r = Math.max(0, Math.min(radius, (right - left) / 2, (bottom - top) / 2));
  fillRect(buffer, size, left + r, top, right - r, bottom, rgba);
  fillRect(buffer, size, left, top + r, right, bottom - r, rgba);
  fillCircle(buffer, size, left + r, top + r, r, rgba);
  fillCircle(buffer, size, right - r, top + r, r, rgba);
  fillCircle(buffer, size, left + r, bottom - r, r, rgba);
  fillCircle(buffer, size, right - r, bottom - r, r, rgba);
}

function fillPolygon(buffer, size, points, rgba) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(size - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y += 1) {
    const scanY = y + 0.5;
    const intersections = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a[1] <= scanY && b[1] > scanY) || (b[1] <= scanY && a[1] > scanY)) {
        const t = (scanY - a[1]) / (b[1] - a[1]);
        intersections.push(a[0] + t * (b[0] - a[0]));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const x0 = Math.max(0, Math.floor(intersections[i]));
      const x1 = Math.min(size - 1, Math.ceil(intersections[i + 1]));
      for (let x = x0; x <= x1; x += 1) blendPixel(buffer, size, x, y, rgba);
    }
  }
}

function drawThickLine(buffer, size, x1, y1, x2, y2, thickness, rgba) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(1, Math.hypot(dx, dy));
  const steps = Math.ceil(length);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    fillCircle(buffer, size, x1 + dx * t, y1 + dy * t, thickness / 2, rgba);
  }
}

function drawHeart(buffer, size, cx, cy, scale, rgba) {
  const r = scale * 0.24;
  fillCircle(buffer, size, cx - scale * 0.17, cy - scale * 0.10, r, rgba);
  fillCircle(buffer, size, cx + scale * 0.17, cy - scale * 0.10, r, rgba);
  fillPolygon(
    buffer,
    size,
    [
      [cx - scale * 0.40, cy - scale * 0.03],
      [cx + scale * 0.40, cy - scale * 0.03],
      [cx, cy + scale * 0.43]
    ],
    rgba
  );
}

function drawFace(buffer, size, cx, cy, radius, hair, shirt, lookRight) {
  fillEllipse(buffer, size, cx, cy + radius * 1.13, radius * 1.08, radius * 0.72, shirt);
  fillCircle(buffer, size, cx, cy, radius, C.skin);

  fillEllipse(buffer, size, cx, cy - radius * 0.36, radius * 1.00, radius * 0.70, hair);
  fillCircle(buffer, size, cx - radius * 0.58, cy - radius * 0.08, radius * 0.48, hair);
  if (!lookRight) fillCircle(buffer, size, cx + radius * 0.54, cy - radius * 0.26, radius * 0.38, hair);
  if (lookRight) fillCircle(buffer, size, cx + radius * 0.56, cy - radius * 0.10, radius * 0.44, hair);

  const eye = hex("#3A2925");
  fillEllipse(buffer, size, cx - radius * 0.34, cy + radius * 0.03, radius * 0.075, radius * 0.11, eye);
  fillEllipse(buffer, size, cx + radius * 0.34, cy + radius * 0.03, radius * 0.075, radius * 0.11, eye);

  const cheek = [...C.coral];
  cheek[3] = 90;
  fillEllipse(buffer, size, cx - radius * 0.55, cy + radius * 0.28, radius * 0.18, radius * 0.10, cheek);
  fillEllipse(buffer, size, cx + radius * 0.55, cy + radius * 0.28, radius * 0.18, radius * 0.10, cheek);

  drawThickLine(
    buffer,
    size,
    cx - radius * 0.14,
    cy + radius * 0.34,
    cx + radius * 0.14,
    cy + radius * 0.34,
    radius * 0.07,
    eye
  );
}

function drawCoin(buffer, size, cx, cy, radius) {
  fillCircle(buffer, size, cx, cy, radius, C.goldDark);
  fillCircle(buffer, size, cx, cy, radius * 0.86, C.gold);
  fillPolygon(
    buffer,
    size,
    [
      [cx, cy - radius * 0.32],
      [cx - radius * 0.34, cy - radius * 0.02],
      [cx - radius * 0.24, cy - radius * 0.02],
      [cx - radius * 0.24, cy + radius * 0.30],
      [cx + radius * 0.24, cy + radius * 0.30],
      [cx + radius * 0.24, cy - radius * 0.02],
      [cx + radius * 0.34, cy - radius * 0.02]
    ],
    C.goldDark
  );
  drawHeart(buffer, size, cx, cy + radius * 0.10, radius * 0.35, C.panel);
}

function createIconPixels(size, maskable) {
  const supersample = size <= 192 ? 3 : 2;
  const renderSize = size * supersample;
  const pixels = Buffer.alloc(renderSize * renderSize * 4);
  const s = renderSize;
  const u = (value) => value * s;

  fillRect(pixels, s, 0, 0, s, s, C.background);

  const safeInset = maskable ? u(0.105) : u(0.045);
  const shadow = [...C.shadow];
  shadow[3] = ICON_THEME === "night" ? 75 : 35;
  fillRoundedRect(
    pixels,
    s,
    safeInset + u(0.012),
    safeInset + u(0.018),
    s - safeInset + u(0.012),
    s - safeInset + u(0.018),
    u(0.105),
    shadow
  );
  fillRoundedRect(
    pixels,
    s,
    safeInset,
    safeInset,
    s - safeInset,
    s - safeInset,
    u(0.105),
    C.border
  );

  const borderW = u(0.012);
  fillRoundedRect(
    pixels,
    s,
    safeInset + borderW,
    safeInset + borderW,
    s - safeInset - borderW,
    s - safeInset - borderW,
    u(0.095),
    C.panel
  );

  // House body and roof.
  fillRoundedRect(pixels, s, u(0.245), u(0.285), u(0.755), u(0.625), u(0.035), C.page);
  fillPolygon(
    pixels,
    s,
    [
      [u(0.185), u(0.345)],
      [u(0.500), u(0.145)],
      [u(0.815), u(0.345)],
      [u(0.755), u(0.385)],
      [u(0.500), u(0.225)],
      [u(0.245), u(0.385)]
    ],
    C.roofDark
  );
  fillPolygon(
    pixels,
    s,
    [
      [u(0.198), u(0.328)],
      [u(0.500), u(0.153)],
      [u(0.802), u(0.328)],
      [u(0.758), u(0.360)],
      [u(0.500), u(0.210)],
      [u(0.242), u(0.360)]
    ],
    C.roof
  );
  fillRoundedRect(pixels, s, u(0.682), u(0.178), u(0.735), u(0.300), u(0.015), C.roof);
  fillRoundedRect(pixels, s, u(0.673), u(0.164), u(0.744), u(0.205), u(0.016), C.navy);
  drawHeart(pixels, s, u(0.50), u(0.285), u(0.075), C.coral);

  // Two tiny people, deliberately simplified for small home-screen sizes.
  drawFace(pixels, s, u(0.405), u(0.455), u(0.083), C.hairLeft, C.shirtLeft, false);
  drawFace(pixels, s, u(0.595), u(0.455), u(0.083), C.hairRight, C.shirtRight, true);

  // Wallet / open ledger.
  fillRoundedRect(pixels, s, u(0.185), u(0.570), u(0.815), u(0.835), u(0.055), C.navy);
  fillRoundedRect(pixels, s, u(0.205), u(0.590), u(0.495), u(0.745), u(0.035), C.page);
  fillRoundedRect(pixels, s, u(0.505), u(0.590), u(0.795), u(0.745), u(0.035), C.page);
  drawThickLine(pixels, s, u(0.500), u(0.595), u(0.500), u(0.760), u(0.010), C.navySoft);

  // Card pocket.
  fillRoundedRect(pixels, s, u(0.225), u(0.665), u(0.430), u(0.770), u(0.025), C.navySoft);
  fillRoundedRect(pixels, s, u(0.245), u(0.640), u(0.405), u(0.705), u(0.020), C.coral);
  fillRoundedRect(pixels, s, u(0.260), u(0.650), u(0.300), u(0.678), u(0.007), C.panel);

  // Bills and coin pocket.
  const bill = [...C.green];
  bill[3] = 220;
  fillRoundedRect(pixels, s, u(0.595), u(0.635), u(0.735), u(0.725), u(0.012), bill);
  fillCircle(pixels, s, u(0.665), u(0.680), u(0.022), C.panel);
  drawCoin(pixels, s, u(0.675), u(0.742), u(0.065));

  // Shared-heart motif in the middle of the ledger.
  drawHeart(pixels, s, u(0.500), u(0.735), u(0.095), C.coral);
  drawHeart(pixels, s, u(0.500), u(0.735), u(0.040), C.coralDark);

  return supersample === 1 ? pixels : downsample(pixels, renderSize, size, supersample);
}

function downsample(source, sourceSize, targetSize, scale) {
  const target = Buffer.alloc(targetSize * targetSize * 4);
  const samples = scale * scale;
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const srcX = x * scale + sx;
          const srcY = y * scale + sy;
          const index = (srcY * sourceSize + srcX) * 4;
          r += source[index];
          g += source[index + 1];
          b += source[index + 2];
          a += source[index + 3];
        }
      }
      const out = (y * targetSize + x) * 4;
      target[out] = Math.round(r / samples);
      target[out + 1] = Math.round(g / samples);
      target[out + 2] = Math.round(b / samples);
      target[out + 3] = Math.round(a / samples);
    }
  }
  return target;
}

function encodePng(size, rgbaPixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const scanlines = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (1 + size * 4);
    const sourceOffset = y * size * 4;
    scanlines[rowOffset] = 0;
    rgbaPixels.copy(scanlines, rowOffset + 1, sourceOffset, sourceOffset + size * 4);
  }

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

for (const [relativePath, size, maskable] of OUTPUTS) {
  const outputPath = resolve(relativePath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, encodePng(size, createIconPixels(size, maskable)));
  console.log(`generated ${relativePath} (${size}x${size}) theme=${ICON_THEME}`);
}
