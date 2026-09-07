import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

// 분위기를 바꾸고 싶으면 이 값만 변경.
// 빌드 시 환경변수로도 덮어쓸 수 있음.
// 예: MONEYBOOK_ICON_THEME=spring npm run build
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
    coral: "#FF8778",
    gold: "#F2BF4D",
    goldDark: "#D89A25",
    green: "#95C989",
    page: "#FFF3D5",
    shadow: "#18354A",
  },

  spring: {
    background: "#F8FFF8",
    panel: "#FFFDF8",
    border: "#BDE8CC",
    roof: "#83D4AC",
    roofDark: "#55A984",
    navy: "#375A64",
    coral: "#FFA0AA",
    gold: "#F5CF67",
    goldDark: "#D7AA39",
    green: "#A9D990",
    page: "#FFF7DC",
    shadow: "#33555D",
  },

  peach: {
    background: "#FFF6F1",
    panel: "#FFFCF9",
    border: "#F4C7BA",
    roof: "#EFA995",
    roofDark: "#CF806D",
    navy: "#4B4054",
    coral: "#FF7F73",
    gold: "#F3C55A",
    goldDark: "#D7A232",
    green: "#A9C994",
    page: "#FFF0DA",
    shadow: "#493B4C",
  },

  blue: {
    background: "#F3FAFF",
    panel: "#FCFEFF",
    border: "#BDDDF1",
    roof: "#80C8E7",
    roofDark: "#4A9FC3",
    navy: "#244767",
    coral: "#FF8B8E",
    gold: "#F1C45E",
    goldDark: "#D6A33A",
    green: "#91CDB6",
    page: "#FFF5DD",
    shadow: "#1E405C",
  },

  night: {
    background: "#1D2940",
    panel: "#27354F",
    border: "#607CA5",
    roof: "#6FB6AA",
    roofDark: "#4B8E86",
    navy: "#152238",
    coral: "#FF8D91",
    gold: "#F2C969",
    goldDark: "#D6A644",
    green: "#7FB997",
    page: "#EEDFBF",
    shadow: "#0D1626",
  },
};

const OUTPUTS = [
  ["public/apple-touch-icon.png", 180, false],
  ["public/icon-192.png", 192, false],
  ["public/icon-512.png", 512, false],
  ["public/maskable-512.png", 512, true],
];

const theme = THEMES[ICON_THEME];

if (!theme) {
  throw new Error(
    `Unknown MONEYBOOK_ICON_THEME: ${ICON_THEME}. Choose one of: ${Object.keys(
      THEMES
    ).join(", ")}`
  );
}

function hex(value, alpha = 255) {
  const clean = value.replace("#", "");

  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
    alpha,
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
      c =
        (c & 1) !== 0
          ? 0xedb88320 ^ (c >>> 1)
          : c >>> 1;
    }

    table[n] = c >>> 0;
  }

  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc =
      crcTable[(crc ^ byte) & 0xff] ^
      (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);

  length.writeUInt32BE(data.length, 0);

  crc.writeUInt32BE(
    crc32(Buffer.concat([typeBuffer, data])),
    0
  );

  return Buffer.concat([
    length,
    typeBuffer,
    data,
    crc,
  ]);
}

function blendPixel(buffer, size, x, y, rgba) {
  if (
    x < 0 ||
    y < 0 ||
    x >= size ||
    y >= size
  ) {
    return;
  }

  const index =
    (y * size + x) * 4;

  const sa = rgba[3] / 255;

  if (sa >= 0.999) {
    buffer[index] = rgba[0];
    buffer[index + 1] = rgba[1];
    buffer[index + 2] = rgba[2];
    buffer[index + 3] = rgba[3];
    return;
  }

  const da =
    buffer[index + 3] / 255;

  const outA =
    sa + da * (1 - sa);

  if (outA <= 0) {
    return;
  }

  buffer[index] = Math.round(
    (rgba[0] * sa +
      buffer[index] *
        da *
        (1 - sa)) /
      outA
  );

  buffer[index + 1] = Math.round(
    (rgba[1] * sa +
      buffer[index + 1] *
        da *
        (1 - sa)) /
      outA
  );

  buffer[index + 2] = Math.round(
    (rgba[2] * sa +
      buffer[index + 2] *
        da *
        (1 - sa)) /
      outA
  );

  buffer[index + 3] =
    Math.round(outA * 255);
}

function fillRect(
  buffer,
  size,
  left,
  top,
  right,
  bottom,
  rgba
) {
  for (
    let y = Math.max(0, Math.floor(top));
    y < Math.min(size, Math.ceil(bottom));
    y += 1
  ) {
    for (
      let x = Math.max(0, Math.floor(left));
      x < Math.min(size, Math.ceil(right));
      x += 1
    ) {
      blendPixel(
        buffer,
        size,
        x,
        y,
        rgba
      );
    }
  }
}

function fillCircle(
  buffer,
  size,
  cx,
  cy,
  radius,
  rgba
) {
  const r2 =
    radius * radius;

  for (
    let y = Math.max(
      0,
      Math.floor(cy - radius)
    );
    y <=
    Math.min(
      size - 1,
      Math.ceil(cy + radius)
    );
    y += 1
  ) {
    for (
      let x = Math.max(
        0,
        Math.floor(cx - radius)
      );
      x <=
      Math.min(
        size - 1,
        Math.ceil(cx + radius)
      );
      x += 1
    ) {
      const dx =
        x + 0.5 - cx;

      const dy =
        y + 0.5 - cy;

      if (
        dx * dx + dy * dy <=
        r2
      ) {
        blendPixel(
          buffer,
          size,
          x,
          y,
          rgba
        );
      }
    }
  }
}

function fillRoundedRect(
  buffer,
  size,
  left,
  top,
  right,
  bottom,
  radius,
  rgba
) {
  const r = Math.max(
    0,
    Math.min(
      radius,
      (right - left) / 2,
      (bottom - top) / 2
    )
  );

  fillRect(
    buffer,
    size,
    left + r,
    top,
    right - r,
    bottom,
    rgba
  );

  fillRect(
    buffer,
    size,
    left,
    top + r,
    right,
    bottom - r,
    rgba
  );

  fillCircle(
    buffer,
    size,
    left + r,
    top + r,
    r,
    rgba
  );

  fillCircle(
    buffer,
    size,
    right - r,
    top + r,
    r,
    rgba
  );

  fillCircle(
    buffer,
    size,
    left + r,
    bottom - r,
    r,
    rgba
  );

  fillCircle(
    buffer,
    size,
    right - r,
    bottom - r,
    r,
    rgba
  );
}

function fillPolygon(
  buffer,
  size,
  points,
  rgba
) {
  const ys =
    points.map(([, y]) => y);

  for (
    let y = Math.max(
      0,
      Math.floor(Math.min(...ys))
    );
    y <=
    Math.min(
      size - 1,
      Math.ceil(Math.max(...ys))
    );
    y += 1
  ) {
    const scanY =
      y + 0.5;

    const intersections = [];

    for (
      let i = 0;
      i < points.length;
      i += 1
    ) {
      const a =
        points[i];

      const b =
        points[
          (i + 1) %
            points.length
        ];

      if (
        (a[1] <= scanY &&
          b[1] > scanY) ||
        (b[1] <= scanY &&
          a[1] > scanY)
      ) {
        const t =
          (scanY - a[1]) /
          (b[1] - a[1]);

        intersections.push(
          a[0] +
            t *
              (b[0] - a[0])
        );
      }
    }

    intersections.sort(
      (a, b) => a - b
    );

    for (
      let i = 0;
      i + 1 <
      intersections.length;
      i += 2
    ) {
      for (
        let x = Math.max(
          0,
          Math.floor(
            intersections[i]
          )
        );
        x <=
        Math.min(
          size - 1,
          Math.ceil(
            intersections[i + 1]
          )
        );
        x += 1
      ) {
        blendPixel(
          buffer,
          size,
          x,
          y,
          rgba
        );
      }
    }
  }
}

function drawHeart(
  buffer,
  size,
  cx,
  cy,
  scale,
  rgba
) {
  const r =
    scale * 0.24;

  fillCircle(
    buffer,
    size,
    cx - scale * 0.17,
    cy - scale * 0.1,
    r,
    rgba
  );

  fillCircle(
    buffer,
    size,
    cx + scale * 0.17,
    cy - scale * 0.1,
    r,
    rgba
  );

  fillPolygon(
    buffer,
    size,
    [
      [
        cx - scale * 0.4,
        cy - scale * 0.03,
      ],
      [
        cx + scale * 0.4,
        cy - scale * 0.03,
      ],
      [
        cx,
        cy + scale * 0.43,
      ],
    ],
    rgba
  );
}

function drawCoin(
  buffer,
  size,
  cx,
  cy,
  radius
) {
  fillCircle(
    buffer,
    size,
    cx,
    cy,
    radius,
    C.goldDark
  );

  fillCircle(
    buffer,
    size,
    cx,
    cy,
    radius * 0.84,
    C.gold
  );

  drawHeart(
    buffer,
    size,
    cx,
    cy + radius * 0.02,
    radius * 0.58,
    C.panel
  );
}

function createIconPixels(
  size,
  maskable
) {
  const supersample =
    size <= 192 ? 3 : 2;

  const renderSize =
    size * supersample;

  const pixels =
    Buffer.alloc(
      renderSize *
        renderSize *
        4
    );

  const s =
    renderSize;

  const u = (value) =>
    value * s;

  fillRect(
    pixels,
    s,
    0,
    0,
    s,
    s,
    C.background
  );

  const safeInset =
    maskable
      ? u(0.105)
      : u(0.045);

  const shadow = [
    ...C.shadow,
  ];

  shadow[3] =
    ICON_THEME === "night"
      ? 75
      : 35;

  fillRoundedRect(
    pixels,
    s,
    safeInset + u(0.012),
    safeInset + u(0.018),
    s -
      safeInset +
      u(0.012),
    s -
      safeInset +
      u(0.018),
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

  fillRoundedRect(
    pixels,
    s,
    safeInset + u(0.012),
    safeInset + u(0.012),
    s -
      safeInset -
      u(0.012),
    s -
      safeInset -
      u(0.012),
    u(0.095),
    C.panel
  );

  // 한 지붕 아래 함께 사는 집.
  fillRoundedRect(
    pixels,
    s,
    u(0.275),
    u(0.300),
    u(0.725),
    u(0.570),
    u(0.035),
    C.page
  );

  fillPolygon(
    pixels,
    s,
    [
      [
        u(0.205),
        u(0.350),
      ],
      [
        u(0.500),
        u(0.165),
      ],
      [
        u(0.795),
        u(0.350),
      ],
      [
        u(0.748),
        u(0.390),
      ],
      [
        u(0.500),
        u(0.235),
      ],
      [
        u(0.252),
        u(0.390),
      ],
    ],
    C.roofDark
  );

  fillPolygon(
    pixels,
    s,
    [
      [
        u(0.218),
        u(0.334),
      ],
      [
        u(0.500),
        u(0.170),
      ],
      [
        u(0.782),
        u(0.334),
      ],
      [
        u(0.748),
        u(0.365),
      ],
      [
        u(0.500),
        u(0.218),
      ],
      [
        u(0.252),
        u(0.365),
      ],
    ],
    C.roof
  );

  // 두 개의 하트 = 우리 둘.
  drawHeart(
    pixels,
    s,
    u(0.435),
    u(0.420),
    u(0.095),
    C.coral
  );

  drawHeart(
    pixels,
    s,
    u(0.565),
    u(0.420),
    u(0.095),
    C.roofDark
  );

  // 함께 쓰는 지갑 / 가계부.
  fillRoundedRect(
    pixels,
    s,
    u(0.205),
    u(0.535),
    u(0.795),
    u(0.820),
    u(0.060),
    C.navy
  );

  fillRoundedRect(
    pixels,
    s,
    u(0.225),
    u(0.560),
    u(0.775),
    u(0.690),
    u(0.032),
    C.page
  );

  // 카드.
  fillRoundedRect(
    pixels,
    s,
    u(0.255),
    u(0.610),
    u(0.420),
    u(0.700),
    u(0.022),
    C.coral
  );

  fillRoundedRect(
    pixels,
    s,
    u(0.278),
    u(0.628),
    u(0.315),
    u(0.660),
    u(0.007),
    C.panel
  );

  // 지폐.
  const bill = [
    ...C.green,
  ];

  bill[3] = 220;

  fillRoundedRect(
    pixels,
    s,
    u(0.565),
    u(0.600),
    u(0.715),
    u(0.695),
    u(0.018),
    bill
  );

  fillCircle(
    pixels,
    s,
    u(0.640),
    u(0.647),
    u(0.022),
    C.panel
  );

  // 가운데 하트.
  drawHeart(
    pixels,
    s,
    u(0.500),
    u(0.710),
    u(0.115),
    C.coral
  );

  // 동전.
  drawCoin(
    pixels,
    s,
    u(0.680),
    u(0.735),
    u(0.062)
  );

  return supersample === 1
    ? pixels
    : downsample(
        pixels,
        renderSize,
        size,
        supersample
      );
}

function downsample(
  source,
  sourceSize,
  targetSize,
  scale
) {
  const target =
    Buffer.alloc(
      targetSize *
        targetSize *
        4
    );

  const samples =
    scale * scale;

  for (
    let y = 0;
    y < targetSize;
    y += 1
  ) {
    for (
      let x = 0;
      x < targetSize;
      x += 1
    ) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (
        let sy = 0;
        sy < scale;
        sy += 1
      ) {
        for (
          let sx = 0;
          sx < scale;
          sx += 1
        ) {
          const index =
            ((y * scale +
              sy) *
              sourceSize +
              (x * scale +
                sx)) *
            4;

          r += source[index];
          g +=
            source[
              index + 1
            ];
          b +=
            source[
              index + 2
            ];
          a +=
            source[
              index + 3
            ];
        }
      }

      const out =
        (y * targetSize +
          x) *
        4;

      target[out] =
        Math.round(
          r / samples
        );

      target[out + 1] =
        Math.round(
          g / samples
        );

      target[out + 2] =
        Math.round(
          b / samples
        );

      target[out + 3] =
        Math.round(
          a / samples
        );
    }
  }

  return target;
}

function encodePng(
  size,
  rgbaPixels
) {
  const signature =
    Buffer.from([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
    ]);

  const ihdr =
    Buffer.alloc(13);

  ihdr.writeUInt32BE(
    size,
    0
  );

  ihdr.writeUInt32BE(
    size,
    4
  );

  ihdr[8] = 8;
  ihdr[9] = 6;

  const scanlines =
    Buffer.alloc(
      size *
        (1 + size * 4)
    );

  for (
    let y = 0;
    y < size;
    y += 1
  ) {
    const rowOffset =
      y *
      (1 + size * 4);

    const sourceOffset =
      y *
      size *
      4;

    rgbaPixels.copy(
      scanlines,
      rowOffset + 1,
      sourceOffset,
      sourceOffset +
        size * 4
    );
  }

  return Buffer.concat([
    signature,
    pngChunk(
      "IHDR",
      ihdr
    ),
    pngChunk(
      "IDAT",
      deflateSync(
        scanlines,
        { level: 9 }
      )
    ),
    pngChunk(
      "IEND",
      Buffer.alloc(0)
    ),
  ]);
}

for (const [
  relativePath,
  size,
  maskable,
] of OUTPUTS) {
  const outputPath =
    resolve(relativePath);

  await mkdir(
    dirname(outputPath),
    { recursive: true }
  );

  await writeFile(
    outputPath,
    encodePng(
      size,
      createIconPixels(
        size,
        maskable
      )
    )
  );

  console.log(
    `generated ${relativePath} (${size}x${size}) theme=${ICON_THEME}`
  );
}
