const MAX_WIDTH = 1600;
const MAX_HEIGHT = 5000;
const MAX_DATA_URL_LENGTH = 4_200_000;
const JPEG_QUALITIES = [0.88, 0.78, 0.66, 0.54];

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

function renderJpeg(image: HTMLImageElement, width: number, height: number, quality: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function prepareImportImage(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 선택할 수 있습니다.");
  }

  const original = await fileToDataUrl(file);
  const image = await loadImage(original);
  let scale = Math.min(
    1,
    MAX_WIDTH / Math.max(1, image.naturalWidth),
    MAX_HEIGHT / Math.max(1, image.naturalHeight)
  );

  for (let resizeAttempt = 0; resizeAttempt < 3; resizeAttempt += 1) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    for (const quality of JPEG_QUALITIES) {
      const result = renderJpeg(image, width, height, quality);
      if (result && result.length <= MAX_DATA_URL_LENGTH) return result;
    }
    scale *= 0.82;
  }

  throw new Error("이미지가 너무 큽니다. 스크롤 캡처를 여러 장으로 나눠서 선택해주세요.");
}
