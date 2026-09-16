import {
  dedupeImportedCandidates,
  extractJsonValue,
  normalizeImportedCandidate
} from "./domain/transactionImport.js";

const FAST_IMAGE_MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const FALLBACK_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_AI_CONCURRENCY = 4;
const MAX_TEXT_LENGTH = 20000;
const MAX_IMAGES = 8;
const MAX_IMAGE_DATA_URL_LENGTH = 4_500_000;

function getOutputText(response) {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "";

  const choiceContent = response.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string") return choiceContent;
  if (Array.isArray(choiceContent)) {
    const joined = choiceContent
      .map((part) => typeof part === "string" ? part : part?.text)
      .filter((part) => typeof part === "string")
      .join("\n");
    if (joined) return joined;
  }

  for (const key of ["response", "result", "answer", "text"]) {
    if (typeof response[key] === "string") return response[key];
    if (response[key] && typeof response[key] === "object") return JSON.stringify(response[key]);
  }
  return JSON.stringify(response);
}

function buildPrompt({ today, sourceLabel }) {
  return `Read the Korean card/payment ${sourceLabel} carefully and extract ALL visible purchase, approval, charge, cancellation, or refund rows.
Today is ${today}. If a row has a merchant and an amount, KEEP IT even when the date, time, or card name is unclear. Do not return an empty list when real transaction rows are visible.
Return JSON only: {"transactions":[{"d":"YYYY-MM-DD or empty","t":"HH:MM or empty","m":"merchant","a":12500,"s":"expense or refund","c":"card name or empty","r":"short text copied from that row"}]}
Ignore totals, balances, limits, points, section headings, and bill summaries. Amounts are positive integer KRW. Keep repeated purchases as separate rows. For unclear fields use an empty string or 0 instead of dropping the transaction. Infer a missing year from today when reasonable.`;
}

function isUsefulTransactionList(values) {
  if (!Array.isArray(values) || values.length === 0) return false;
  return values.some((item) => {
    if (!item || typeof item !== "object") return false;
    const date = item.d ?? item.date;
    const amount = Number(String(item.a ?? item.amount ?? "").replace(/[^0-9.-]/g, ""));
    const merchant = String(item.m ?? item.merchant ?? item.description ?? "").trim();
    return [Boolean(date), amount > 0, Boolean(merchant)].filter(Boolean).length >= 2;
  });
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }
  const count = Math.min(Math.max(1, limit), values.length || 1);
  await Promise.all(Array.from({ length: count }, () => worker()));
  return results;
}

async function runText(env, prompt, text) {
  const response = await env.AI.run(FALLBACK_MODEL, {
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: String(text || "").slice(0, MAX_TEXT_LENGTH) }
    ],
    max_tokens: 2048,
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false }
  });
  return extractJsonValue(getOutputText(response));
}

async function runImageFallback(env, prompt, image) {
  const response = await env.AI.run(FALLBACK_MODEL, {
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this screenshot closely. Extract every visible transaction row and return only the requested JSON." },
          { type: "image_url", image_url: { url: image } }
        ]
      }
    ],
    max_completion_tokens: 2048,
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false }
  });
  return extractJsonValue(getOutputText(response));
}

async function runImage(env, prompt, image) {
  try {
    const response = await env.AI.run(FAST_IMAGE_MODEL, {
      task: "query",
      image,
      question: prompt,
      reasoning: false,
      temperature: 0,
      max_tokens: 2048
    });
    const values = extractJsonValue(getOutputText(response));
    if (isUsefulTransactionList(values)) return values;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    const terminal = error?.status === 429 || /(?:429|quota|rate.?limit|neuron|usage.?limit|too many requests)/i.test(message);
    if (terminal) throw error;
  }
  return runImageFallback(env, prompt, image);
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
    sourceLabel: text && images.length ? "provided text and screenshot(s)" : text ? "provided text" : "screenshot"
  });
  const validImages = [];
  for (const image of images) {
    const value = String(image || "");
    if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(value)) continue;
    if (value.length > MAX_IMAGE_DATA_URL_LENGTH) {
      const error = new Error("이미지가 너무 큽니다. 더 작은 캡처로 다시 시도해주세요.");
      error.code = "IMPORT_IMAGE_TOO_LARGE";
      throw error;
    }
    validImages.push(value);
  }

  const jobs = [];
  if (text) jobs.push(() => runText(env, prompt, text));
  for (const image of validImages) jobs.push(() => runImage(env, prompt, image));

  const groups = await mapWithConcurrency(jobs, MAX_AI_CONCURRENCY, (job) => job());
  const raw = groups.flat();
  return dedupeImportedCandidates(raw.map((item, index) => normalizeImportedCandidate(item, index)));
}
