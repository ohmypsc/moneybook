import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const ALLOWED_FETCH_FILE = path.normalize("src/api/client.ts");
const ROOT_DUPLICATES = [
  "App.tsx",
  "App.module.css",
  "main.tsx",
  "vite-env.d.ts"
];

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

const errors = [];

for (const name of ROOT_DUPLICATES) {
  try {
    await fs.access(path.join(ROOT, name));
    errors.push(`루트 중복 파일이 남아 있습니다: ${name}`);
  } catch {
    // Expected: the real entry files live under src/.
  }
}

for (const file of await walk(SRC)) {
  const relative = path.normalize(path.relative(ROOT, file));
  const source = await fs.readFile(file, "utf8");

  if (/\bwindow\.confirm\s*\(/.test(source)) {
    errors.push(`${relative}: window.confirm 대신 confirmAction을 사용하세요.`);
  }

  if (/\bwindow\.fetch\s*=/.test(source)) {
    errors.push(`${relative}: 전역 fetch monkey patch는 허용하지 않습니다.`);
  }

  if (
    relative !== ALLOWED_FETCH_FILE &&
    /(^|[^.\w])fetch\s*\(/m.test(source)
  ) {
    errors.push(`${relative}: 직접 fetch 대신 apiRequest를 사용하세요.`);
  }
}

if (errors.length > 0) {
  console.error("소스 경계 검사 실패:\n");
  errors.forEach(error => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log("소스 경계 검사 통과");
}
