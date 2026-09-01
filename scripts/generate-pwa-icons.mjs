import {
  mkdir,
  writeFile
} from "node:fs/promises";

import {
  dirname,
  resolve
} from "node:path";

import {
  deflateSync
} from "node:zlib";


const OUTPUTS = [
  [
    "public/apple-touch-icon.png",
    180,
    false
  ],
  [
    "public/icon-192.png",
    192,
    false
  ],
  [
    "public/icon-512.png",
    512,
    false
  ],
  [
    "public/maskable-512.png",
    512,
    true
  ]
];


const BACKGROUND = [
  23,
  50,
  77,
  255
];

const FOREGROUND = [
  255,
  255,
  255,
  255
];

const ACCENT = [
  197,
  221,
  239,
  255
];


const crcTable =
  (() => {
    const table =
      new Uint32Array(
        256
      );


    for (
      let n = 0;
      n < 256;
      n += 1
    ) {
      let c =
        n;


      for (
        let k = 0;
        k < 8;
        k += 1
      ) {
        c =
          (
            c & 1
          ) !== 0
            ? (
                0xedb88320 ^
                (
                  c >>>
                  1
                )
              )
            : (
                c >>>
                1
              );
      }


      table[n] =
        c >>> 0;
    }


    return table;
  })();


function crc32(
  buffer
) {
  let crc =
    0xffffffff;


  for (
    const byte
    of buffer
  ) {
    crc =
      crcTable[
        (
          crc ^
          byte
        ) &
        0xff
      ] ^
      (
        crc >>>
        8
      );
  }


  return (
    crc ^
    0xffffffff
  ) >>> 0;
}


function pngChunk(
  type,
  data
) {
  const typeBuffer =
    Buffer.from(
      type,
      "ascii"
    );

  const length =
    Buffer.alloc(
      4
    );

  const crc =
    Buffer.alloc(
      4
    );


  length.writeUInt32BE(
    data.length,
    0
  );


  const crcValue =
    crc32(
      Buffer.concat([
        typeBuffer,
        data
      ])
    );


  crc.writeUInt32BE(
    crcValue,
    0
  );


  return Buffer.concat([
    length,
    typeBuffer,
    data,
    crc
  ]);
}


function setPixel(
  buffer,
  size,
  x,
  y,
  rgba
) {
  if (
    x < 0 ||
    y < 0 ||
    x >= size ||
    y >= size
  ) {
    return;
  }


  const index =
    (
      y * size +
      x
    ) *
    4;


  buffer[index] =
    rgba[0];

  buffer[
    index + 1
  ] =
    rgba[1];

  buffer[
    index + 2
  ] =
    rgba[2];

  buffer[
    index + 3
  ] =
    rgba[3];
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
  const x0 =
    Math.max(
      0,
      Math.floor(
        left
      )
    );

  const y0 =
    Math.max(
      0,
      Math.floor(
        top
      )
    );

  const x1 =
    Math.min(
      size,
      Math.ceil(
        right
      )
    );

  const y1 =
    Math.min(
      size,
      Math.ceil(
        bottom
      )
    );


  for (
    let y = y0;
    y < y1;
    y += 1
  ) {
    for (
      let x = x0;
      x < x1;
      x += 1
    ) {
      setPixel(
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
  centerX,
  centerY,
  radius,
  rgba
) {
  const radiusSquared =
    radius *
    radius;


  const left =
    Math.max(
      0,
      Math.floor(
        centerX -
        radius
      )
    );

  const right =
    Math.min(
      size - 1,
      Math.ceil(
        centerX +
        radius
      )
    );

  const top =
    Math.max(
      0,
      Math.floor(
        centerY -
        radius
      )
    );

  const bottom =
    Math.min(
      size - 1,
      Math.ceil(
        centerY +
        radius
      )
    );


  for (
    let y = top;
    y <= bottom;
    y += 1
  ) {
    for (
      let x = left;
      x <= right;
      x += 1
    ) {
      const dx =
        x +
        0.5 -
        centerX;

      const dy =
        y +
        0.5 -
        centerY;


      if (
        dx * dx +
          dy * dy <=
        radiusSquared
      ) {
        setPixel(
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
  fillRect(
    buffer,
    size,
    left + radius,
    top,
    right - radius,
    bottom,
    rgba
  );


  fillRect(
    buffer,
    size,
    left,
    top + radius,
    right,
    bottom - radius,
    rgba
  );


  fillCircle(
    buffer,
    size,
    left + radius,
    top + radius,
    radius,
    rgba
  );

  fillCircle(
    buffer,
    size,
    right - radius,
    top + radius,
    radius,
    rgba
  );

  fillCircle(
    buffer,
    size,
    left + radius,
    bottom - radius,
    radius,
    rgba
  );

  fillCircle(
    buffer,
    size,
    right - radius,
    bottom - radius,
    radius,
    rgba
  );
}


function createIconPixels(
  size,
  maskable
) {
  const pixels =
    Buffer.alloc(
      size *
      size *
      4
    );


  for (
    let y = 0;
    y < size;
    y += 1
  ) {
    for (
      let x = 0;
      x < size;
      x += 1
    ) {
      setPixel(
        pixels,
        size,
        x,
        y,
        BACKGROUND
      );
    }
  }


  const safeScale =
    maskable
      ? 0.82
      : 0.92;

  const center =
    size / 2;

  const unit =
    size *
    safeScale;


  const walletLeft =
    center -
    unit *
      0.31;

  const walletRight =
    center +
    unit *
      0.31;

  const walletTop =
    center -
    unit *
      0.17;

  const walletBottom =
    center +
    unit *
      0.20;

  const walletRadius =
    unit *
    0.055;


  fillRoundedRect(
    pixels,
    size,
    walletLeft,
    walletTop,
    walletRight,
    walletBottom,
    walletRadius,
    FOREGROUND
  );


  const flapLeft =
    center +
    unit *
      0.05;

  const flapRight =
    center +
    unit *
      0.31;

  const flapTop =
    center -
    unit *
      0.045;

  const flapBottom =
    center +
    unit *
      0.085;


  fillRoundedRect(
    pixels,
    size,
    flapLeft,
    flapTop,
    flapRight,
    flapBottom,
    unit *
      0.03,
    ACCENT
  );


  fillCircle(
    pixels,
    size,
    center +
      unit *
        0.205,
    center +
      unit *
        0.02,
    unit *
      0.018,
    BACKGROUND
  );


  fillRoundedRect(
    pixels,
    size,
    center -
      unit *
        0.23,
    center -
      unit *
        0.31,
    center +
      unit *
        0.15,
    center -
      unit *
        0.15,
    unit *
      0.03,
    ACCENT
  );


  return pixels;
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
      10
    ]);


  const ihdr =
    Buffer.alloc(
      13
    );


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
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;


  const scanlines =
    Buffer.alloc(
      size *
      (
        1 +
        size *
          4
      )
    );


  for (
    let y = 0;
    y < size;
    y += 1
  ) {
    const rowOffset =
      y *
      (
        1 +
        size *
          4
      );

    const sourceOffset =
      y *
      size *
      4;


    scanlines[
      rowOffset
    ] = 0;


    rgbaPixels.copy(
      scanlines,
      rowOffset + 1,
      sourceOffset,
      sourceOffset +
        size *
          4
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
        {
          level: 9
        }
      )
    ),

    pngChunk(
      "IEND",
      Buffer.alloc(
        0
      )
    )
  ]);
}


for (
  const [
    relativePath,
    size,
    maskable
  ]
  of OUTPUTS
) {
  const outputPath =
    resolve(
      relativePath
    );


  await mkdir(
    dirname(
      outputPath
    ),
    {
      recursive: true
    }
  );


  const pixels =
    createIconPixels(
      size,
      maskable
    );


  await writeFile(
    outputPath,
    encodePng(
      size,
      pixels
    )
  );


  console.log(
    `generated ${relativePath} (${size}x${size})`
  );
}
