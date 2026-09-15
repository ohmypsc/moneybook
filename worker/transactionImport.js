import {
  dedupeImportedCandidates,
  extractJsonValue,
  normalizeImportedCandidate
} from "./domain/transactionImport.js";

const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_TEXT_LENGTH = 20000;
const MAX_IMAGES = 4;
const MAX_IMAGE_DATA_URL_LENGTH = 4_500_000;

function getOutputText(response) {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "";
  for (const key of ["response", "result", "answer", "text"]) {
    if (typeof response[key] === "string") return response[key];
  }
  return JSON.stringify(response);
}

function buildPrompt({ today, categories, paymentMethods, sourceLabel }) {
  const categoryNames = (categories || []).slice(0, 80).map((item) => item.name).filter(Boolean);
  const paymentNames = (paymentMethods || []).slice(0, 50).map((item) => item.displayName || item.accountName).filter(Boolean);
  return `당신은 한국 카드/결제 내역을 구조화하는 도구입니다. ${sourceLabel}에서 실제 개별 거래만 추출하세요.
오늘 날짜는 ${today}입니다.
반드시 JSON 하나만 반환하세요. 설명 문장이나 마크다운을 쓰지 마세요.
형식: {"transactions":[{"date":"YYYY-MM-DD","merchant":"가맹점명","amount":12500,"cardName":"카드명 또는 빈 문자열","category":"기존 카테고리명 또는 빈 문자열","status":"expense 또는 refund","confidence":"high|medium|low","memo":"필요한 경우만","sourceText":"짧은 원문"}]}
규칙:
- 누적사용액, 잔여한도, 포인트, 카드대금 합계는 거래금액으로 추출하지 마세요.
- 승인/결제/이용은 expense, 승인취소/취소/환불은 refund입니다.
- 금액은 양의 정수 원 단위로 반환하세요.
- 연도가 생략된 날짜는 오늘을 기준으로 가장 자연스러운 연도를 사용하세요. 미래 45일 이상이 되면 전년을 우선 고려하세요.
- 동일 거래가 화면 중복/스크롤 겹침으로 두 번 보이면 한 번만 반환하세요.
- 카드명은 화면/문자에서 확인되는 경우에만 쓰세요.
- category는 다음 기존 지출 카테고리 중 가장 적절한 것이 명확할 때만 정확히 같은 이름으로 쓰고, 애매하면 빈 문자열: ${JSON.stringify(categoryNames)}
- cardName을 고를 수 있다면 다음 기존 결제수단 표기를 참고하되 화면에 근거가 없으면 추측하지 마세요: ${JSON.stringify(paymentNames)}
- 거래가 없으면 {"transactions":[]}를 반환하세요.`;
}

async function runText(env, prompt, text) {
  const response = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: String(text || "").slice(0, MAX_TEXT_LENGTH) }
    ],
    max_tokens: 4096,
    temperature: 0.1
  });
  return extractJsonValue(getOutputText(response));
}

async function runImage(env, prompt, image) {
  const response = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: "이 이미지의 카드/결제 거래 내역을 추출하세요." }
    ],
    image,
    max_tokens: 4096,
    temperature: 0.1
  });
  return extractJsonValue(getOutputText(response));
}

export async function analyzeTransactionImport(env, input) {
  if (!env.AI) {
    const error = new Error("Workers AI 바인딩이 연결되어 있지 않습니다.");
    error.code = "AI_NOT_BOUND";
    throw error;
  }

  const text = String(input?.text || "").trim();
  const images = Array.isArray(input?.images) ? input.images.slice(0, MAX_IMAGES) : [];
  if (!text && images.length === 0) {
    const error = new Error("분석할 캡처나 텍스트를 추가해주세요.");
    error.code = "IMPORT_SOURCE_REQUIRED";
    throw error;
  }
  if (text.length > MAX_TEXT_LENGTH) {
    const error = new Error("붙여넣은 텍스트가 너무 깁니다. 여러 번 나눠서 가져와주세요.");
    error.code = "IMPORT_TEXT_TOO_LONG";
    throw error;
  }

  const prompt = buildPrompt({
    today: input.today,
    categories: input.categories,
    paymentMethods: input.paymentMethods,
    sourceLabel: text && images.length ? "텍스트와 이미지" : text ? "붙여넣은 텍스트" : "결제 내역 이미지"
  });
  const raw = [];
  if (text) raw.push(...await runText(env, prompt, text));
  for (const image of images) {
    const value = String(image || "");
    if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(value)) continue;
    if (value.length > MAX_IMAGE_DATA_URL_LENGTH) {
      const error = new Error("이미지가 너무 큽니다. 더 작은 캡처로 다시 시도해주세요.");
      error.code = "IMPORT_IMAGE_TOO_LARGE";
      throw error;
    }
    raw.push(...await runImage(env, prompt, value));
  }

  return dedupeImportedCandidates(raw.map((item, index) => normalizeImportedCandidate(item, index)));
}
