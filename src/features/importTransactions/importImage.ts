const MAX_WIDTH = 1280;
const MAX_HEIGHT = 3600;
const MAX_DATA_URL_LENGTH = 2_800_000;
const JPEG_QUALITIES = [0.8, 0.7, 0.6, 0.52];
const SPLIT_ASPECT_THRESHOLD = 3.15;
const SPLIT_TARGET_ASPECT = 2.7;
const MAX_SPLIT_PARTS = 3;

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = src;
  });
}

function renderJpegRegion(
  image: HTMLImageElement,
  sourceY: number,
  sourceHeight: number,
  width: number,
  height: number,
  quality: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(
    image,
    0,
    sourceY,
    image.naturalWidth,
    sourceHeight,
    0,
    0,
    width,
    height
  );
  return canvas.toDataURL("image/jpeg", quality);
}

function encodeRegion(
  image: HTMLImageElement,
  sourceY: number,
  sourceHeight: number
) {
  let scale = Math.min(
    1,
    MAX_WIDTH / Math.max(1, image.naturalWidth),
    MAX_HEIGHT / Math.max(1, sourceHeight)
  );

  for (let resizeAttempt = 0; resizeAttempt < 3; resizeAttempt += 1) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    for (const quality of JPEG_QUALITIES) {
      const result = renderJpegRegion(image, sourceY, sourceHeight, width, height, quality);
      if (result && result.length <= MAX_DATA_URL_LENGTH) return result;
    }
    scale *= 0.82;
  }
  return "";
}

export async function prepareImportImages(file: File, maxParts = MAX_SPLIT_PARTS) {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 선택할 수 있습니다.");
  }

  const original = await fileToDataUrl(file);
  const image = await loadImage(original);
  const aspect = image.naturalHeight / Math.max(1, image.naturalWidth);
  const allowedParts = Math.max(1, Math.min(MAX_SPLIT_PARTS, Math.floor(maxParts)));
  const partCount = aspect > SPLIT_ASPECT_THRESHOLD && allowedParts > 1
    ? Math.min(allowedParts, Math.max(2, Math.ceil(aspect / SPLIT_TARGET_ASPECT)))
    : 1;

  if (partCount === 1) {
    const result = encodeRegion(image, 0, image.naturalHeight);
    if (result) return [result];
    throw new Error("이미지가 너무 큽니다. 스크롤 캡처를 여러 장으로 나눠서 선택해주세요.");
  }

  const baseHeight = image.naturalHeight / partCount;
  const overlap = Math.min(120, Math.max(36, Math.round(baseHeight * 0.04)));
  const results: string[] = [];
  for (let index = 0; index < partCount; index += 1) {
    const rawStart = Math.round(index * baseHeight);
    const rawEnd = Math.round((index + 1) * baseHeight);
    const start = Math.max(0, rawStart - (index > 0 ? overlap : 0));
    const end = Math.min(image.naturalHeight, rawEnd + (index < partCount - 1 ? overlap : 0));
    const result = encodeRegion(image, start, Math.max(1, end - start));
    if (!result) throw new Error("이미지가 너무 큽니다. 스크롤 캡처를 여러 장으로 나눠서 선택해주세요.");
    results.push(result);
  }
  return results;
}

export async function prepareImportImage(file: File) {
  const [result] = await prepareImportImages(file, 1);
  return result;
}
