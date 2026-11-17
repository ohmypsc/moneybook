// worker/ 와 shared/ 아래 모든 .js 파일의 문법을 검사합니다.
// 새 Worker 모듈을 추가해도 package.json을 고칠 필요가 없습니다.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const roots = ["worker", "shared"];
const files = roots
  .flatMap(root =>
    fs
      .readdirSync(root, { recursive: true })
      .filter(file => String(file).endsWith(".js"))
      .map(file => path.join(root, String(file)))
  )
  .sort();

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
  } catch {
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`Worker 문법 검사 실패: ${failed}개 파일`);
  process.exit(1);
}
console.log(`Worker 문법 검사 통과: ${files.length}개 파일`);
