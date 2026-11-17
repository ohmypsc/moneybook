import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

// 시안 A "두 개의 동전": 두 사람의 돈(라벤더·핑크 원)이 겹치는 자리에 하트.
// 색은 src/styles/tokens.css 의 라벤더·핑크 계열에 맞춤.
const PALETTE = {
  background: "#FBEAF0",
  left: "#A99BD9",
  right: "#F49AB3",
  overlap: "#6E5BB8",
  heart: "#FFFFFF"
};

const OUTPUTS = [
  ["public/apple-touch-icon.png", 180, false],
  ["public/icon-192.png", 192, false],
  ["public/icon-512.png", 512, false],
  ["public/maskable-512.png", 512, true]
];

function hex(value, alpha = 255) {
  const clean = value.replace("#", "");

  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
    alpha
  ];
}

const C = Object.fromEntries(Object.entries(PALETTE).map(([key, value]) => [key, hex(value)]));

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
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return;
  }

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

  if (outA <= 0) {
    return;
  }

  buffer[index] = Math.round((rgba[0] * sa + buffer[index] * da * (1 - sa)) / outA);

  buffer[index + 1] = Math.round((rgba[1] * sa + buffer[index + 1] * da * (1 - sa)) / outA);

  buffer[index + 2] = Math.round((rgba[2] * sa + buffer[index + 2] * da * (1 - sa)) / outA);

  buffer[index + 3] = Math.round(outA * 255);
}

function fillRect(buffer, size, left, top, right, bottom, rgba) {
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(size, Math.ceil(bottom)); y += 1) {
    for (let x = Math.max(0, Math.floor(left)); x < Math.min(size, Math.ceil(right)); x += 1) {
      blendPixel(buffer, size, x, y, rgba);
    }
  }
}

function fillCircle(buffer, size, cx, cy, radius, rgba) {
  const r2 = radius * radius;

  for (
    let y = Math.max(0, Math.floor(cy - radius));
    y <= Math.min(size - 1, Math.ceil(cy + radius));
    y += 1
  ) {
    for (
      let x = Math.max(0, Math.floor(cx - radius));
      x <= Math.min(size - 1, Math.ceil(cx + radius));
      x += 1
    ) {
      const dx = x + 0.5 - cx;

      const dy = y + 0.5 - cy;

      if (dx * dx + dy * dy <= r2) {
        blendPixel(buffer, size, x, y, rgba);
      }
    }
  }
}

function fillPolygon(buffer, size, points, rgba) {
  const ys = points.map(([, y]) => y);

  for (
    let y = Math.max(0, Math.floor(Math.min(...ys)));
    y <= Math.min(size - 1, Math.ceil(Math.max(...ys)));
    y += 1
  ) {
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
      for (
        let x = Math.max(0, Math.floor(intersections[i]));
        x <= Math.min(size - 1, Math.ceil(intersections[i + 1]));
        x += 1
      ) {
        blendPixel(buffer, size, x, y, rgba);
      }
    }
  }
}

function drawHeart(buffer, size, cx, cy, scale, rgba) {
  const r = scale * 0.24;

  fillCircle(buffer, size, cx - scale * 0.17, cy - scale * 0.1, r, rgba);

  fillCircle(buffer, size, cx + scale * 0.17, cy - scale * 0.1, r, rgba);

  fillPolygon(
    buffer,
    size,
    [
      [cx - scale * 0.4, cy - scale * 0.03],
      [cx + scale * 0.4, cy - scale * 0.03],
      [cx, cy + scale * 0.43]
    ],
    rgba
  );
}

function createIconPixels(size, maskable) {
  const supersample = size <= 192 ? 4 : 3;

  const s = size * supersample;

  const pixels = Buffer.alloc(s * s * 4);

  // 기준 좌표는 100x100. maskable 은 안드로이드가 가장자리를 잘라내므로
  // 그림을 가운데로 조금 줄여서(안전 영역 안에) 그림.
  const scale = maskable ? 0.86 : 1;

  const u = value => ((value - 50) * scale + 50) * (s / 100);

  const r = 22 * scale * (s / 100);

  const left = [u(39), u(50)];

  const right = [u(61), u(50)];

  fillRect(pixels, s, 0, 0, s, s, C.background);

  fillCircle(pixels, s, left[0], left[1], r, C.left);

  fillCircle(pixels, s, right[0], right[1], r, C.right);

  // 두 원이 겹치는 부분.
  const r2 = r * r;

  for (let y = Math.floor(left[1] - r); y <= Math.ceil(left[1] + r); y += 1) {
    for (let x = Math.floor(right[0] - r); x <= Math.ceil(left[0] + r); x += 1) {
      const px = x + 0.5;

      const py = y + 0.5;

      const inLeft = (px - left[0]) ** 2 + (py - left[1]) ** 2 <= r2;

      const inRight = (px - right[0]) ** 2 + (py - right[1]) ** 2 <= r2;

      if (inLeft && inRight) {
        blendPixel(pixels, s, x, y, C.overlap);
      }
    }
  }

  drawHeart(pixels, s, u(50), u(51.2), 15 * scale * (s / 100), C.heart);

  return downsample(pixels, s, size, supersample);
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
          const index = ((y * scale + sy) * sourceSize + (x * scale + sx)) * 4;

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

  const scanlines = Buffer.alloc(size * (1 + size * 4));

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (1 + size * 4);

    const sourceOffset = y * size * 4;

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

  console.log(`generated ${relativePath} (${size}x${size})`);
}
