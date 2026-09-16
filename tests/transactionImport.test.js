import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseCategory,
  choosePaymentMethod,
  dedupeImportedCandidates,
  extractJsonValue,
  findDuplicateTransaction,
  normalizeImportedCandidate,
  normalizeMerchant
} from "../worker/domain/transactionImport.js";
import { analyzeTransactionImport } from "../worker/transactionImport.js";

test("import candidate normalizes Korean card approval data", () => {
  const item = normalizeImportedCandidate({
    date: "2026-09-15",
    time: "9:05",
    merchant: "스타벅스 세종점",
    amount: "12,500원",
    cardName: "현대카드",
    status: "expense",
    confidence: "high"
  });
  assert.equal(item.date, "2026-09-15");
  assert.equal(item.time, "09:05");
  assert.equal(item.amount, 12500);
  assert.equal(item.kind, "expense");
});

test("refund/cancel is classified as refund", () => {
  const item = normalizeImportedCandidate({ status: "승인취소", amount: 5000 });
  assert.equal(item.kind, "refund");
});

test("compact vision keys normalize without extra AI output", () => {
  const item = normalizeImportedCandidate({
    d: "2026-09-15",
    t: "7:03",
    m: "Cafe",
    a: 4900,
    s: "expense",
    c: "Card A",
    r: "09/15 07:03 Cafe 4,900"
  });
  assert.equal(item.date, "2026-09-15");
  assert.equal(item.time, "07:03");
  assert.equal(item.merchant, "Cafe");
  assert.equal(item.amount, 4900);
  assert.equal(item.cardName, "Card A");
  assert.match(item.sourceText, /4,900/);
});

test("AI fenced JSON response is extracted", () => {
  const values = extractJsonValue('```json\n{"transactions":[{"amount":5500}]}\n```');
  assert.equal(values.length, 1);
  assert.equal(values[0].amount, 5500);
});

test("Cloudflare chat completion response is extracted", () => {
  const values = extractJsonValue({
    choices: [{
      message: {
        content: '{"transactions":[{"merchant":"스타벅스","amount":5800},{"merchant":"GS25","amount":7200}]}'
      }
    }]
  });
  assert.equal(values.length, 2);
  assert.equal(values[1].merchant, "GS25");
});

test("card label matches account without trailing 카드", () => {
  const match = choosePaymentMethod("현대카드", [
    { accountId: "A1", displayName: "현대카드", active: true, isDeleted: false },
    { accountId: "A2", displayName: "우리체크", active: true, isDeleted: false }
  ]);
  assert.equal(match?.accountId, "A1");
});

test("historical merchant category wins over AI suggestion", () => {
  const result = chooseCategory(
    { merchant: "스타벅스 세종점", suggestedCategoryName: "생활비" },
    [
      { categoryId: "C1", name: "식비", type: "지출", active: true, isDeleted: false },
      { categoryId: "C2", name: "생활비", type: "지출", active: true, isDeleted: false }
    ],
    [{ type: "지출", description: "스타벅스 세종점", categoryId: "C1" }]
  );
  assert.equal(result.category?.categoryId, "C1");
  assert.equal(result.source, "history");
});

test("same amount/date/card is detected as duplicate", () => {
  const match = findDuplicateTransaction(
    { date: "2026-09-15", amount: 12500, merchant: "맘스터치" },
    [{ transactionId: "T1", type: "지출", date: "2026-09-15", amount: 12500, paymentMethodId: "A1", description: "맘스터치", isDeleted: false }],
    "A1"
  );
  assert.equal(match?.transactionId, "T1");
});


test("same amount/date alone is not enough to mark a duplicate", () => {
  const match = findDuplicateTransaction(
    { date: "2026-09-15", amount: 5000, merchant: "카페A" },
    [{ transactionId: "T2", type: "지출", date: "2026-09-15", amount: 5000, paymentMethodId: "A9", description: "편의점", isDeleted: false }],
    "A1"
  );
  assert.equal(match, null);
});

test("overlapping screenshot transactions with the same source row are deduplicated", () => {
  const base = {
    date: "2026-09-15",
    amount: 5000,
    merchant: "카페",
    kind: "expense",
    sourceText: "09/15 14:20 카페 5,000원"
  };
  const values = dedupeImportedCandidates([{ ...base, candidateId: "1" }, { ...base, candidateId: "2" }]);
  assert.equal(values.length, 1);
});

test("same merchant and amount at different times remain separate transactions", () => {
  const base = { date: "2026-09-15", amount: 5800, merchant: "스타벅스", kind: "expense" };
  const values = dedupeImportedCandidates([
    { ...base, candidateId: "1", time: "08:30" },
    { ...base, candidateId: "2", time: "16:20" }
  ]);
  assert.equal(values.length, 2);
});

test("same merchant and amount without time are not silently collapsed when source differs", () => {
  const base = { date: "2026-09-15", amount: 5800, merchant: "스타벅스", kind: "expense" };
  const values = dedupeImportedCandidates([
    { ...base, candidateId: "1", sourceText: "첫 번째 승인 스타벅스 5,800원" },
    { ...base, candidateId: "2", sourceText: "두 번째 승인 스타벅스 5,800원" }
  ]);
  assert.equal(values.length, 2);
});

test("same merchant, amount and minute are preserved when the recognized source rows differ", () => {
  const base = { date: "2026-09-15", time: "12:30", amount: 5800, merchant: "스타벅스", kind: "expense" };
  const values = dedupeImportedCandidates([
    { ...base, candidateId: "1", sourceText: "12:30 스타벅스 5,800원 승인 1" },
    { ...base, candidateId: "2", sourceText: "12:30 스타벅스 5,800원 승인 2" }
  ]);
  assert.equal(values.length, 2);
});

test("incomplete recognizable transaction is preserved for user review", () => {
  const candidate = normalizeImportedCandidate({ merchant: "스타벅스", amount: 5800 }, 0);
  const values = dedupeImportedCandidates([candidate]);
  assert.equal(values.length, 1);
  assert.equal(values[0].date, "");
});

test("transaction import accepts real Cloudflare choices response and keeps multiple rows", async () => {
  let requestPayload = null;
  const env = {
    AI: {
      async run(_model, payload) {
        requestPayload = payload;
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                transactions: [
                  { date: "2026-09-15", time: "08:30", merchant: "스타벅스", amount: 5800, sourceText: "08:30 스타벅스 5,800원" },
                  { date: "2026-09-15", time: "16:20", merchant: "스타벅스", amount: 5800, sourceText: "16:20 스타벅스 5,800원" },
                  { date: "", time: "19:10", merchant: "GS25", amount: 7200, sourceText: "19:10 GS25 7,200원" }
                ]
              })
            }
          }]
        };
      }
    }
  };

  const values = await analyzeTransactionImport(env, {
    text: "카드 승인 내역",
    today: "2026-09-16",
    categories: [],
    paymentMethods: []
  });

  assert.equal(values.length, 3);
  assert.equal(values[0].time, "08:30");
  assert.equal(values[1].time, "16:20");
  assert.equal(values[2].date, "");
  assert.deepEqual(requestPayload.chat_template_kwargs, { enable_thinking: false });
});

test("image import uses Moondream fast query and parses compact transactions", async () => {
  let requestModel = null;
  let requestPayload = null;
  const env = {
    AI: {
      async run(model, payload) {
        requestModel = model;
        requestPayload = payload;
        return {
          answer: '{"transactions":[{"d":"2026-09-15","m":"Store A","a":4100,"r":"09/15 Store A 4,100"},{"d":"2026-09-15","m":"Store B","a":8300,"r":"09/15 Store B 8,300"}]}'
        };
      }
    }
  };

  const image = "data:image/png;base64,AA==";
  const values = await analyzeTransactionImport(env, {
    images: [image],
    today: "2026-09-16"
  });

  assert.equal(requestModel, "@cf/moondream/moondream3.1-9B-A2B");
  assert.equal(requestPayload.task, "query");
  assert.equal(requestPayload.image, image);
  assert.equal(requestPayload.reasoning, false);
  assert.equal(values.length, 2);
  assert.equal(values[0].merchant, "Store A");
  assert.equal(values[1].merchant, "Store B");
});

test("image import falls back to Gemma with the screenshot embedded in multimodal message content", async () => {
  const models = [];
  const payloads = [];
  const env = {
    AI: {
      async run(model, payload) {
        models.push(model);
        payloads.push(payload);
        if (models.length === 1) return { answer: "not json" };
        return {
          choices: [{ message: { content: '{"transactions":[{"date":"2026-09-15","merchant":"Fallback Store","amount":9200}]}' } }]
        };
      }
    }
  };
  const image = "data:image/jpeg;base64,AA==";
  const values = await analyzeTransactionImport(env, {
    images: [image],
    today: "2026-09-16"
  });
  assert.deepEqual(models, [
    "@cf/moondream/moondream3.1-9B-A2B",
    "@cf/google/gemma-4-26b-a4b-it"
  ]);
  const fallbackUser = payloads[1].messages.find((message) => message.role === "user");
  assert.ok(Array.isArray(fallbackUser.content));
  assert.equal(fallbackUser.content[1].type, "image_url");
  assert.equal(fallbackUser.content[1].image_url.url, image);
  assert.equal(payloads[1].image, undefined);
  assert.equal(values[0].merchant, "Fallback Store");
});

test("multiple images are analyzed concurrently", async () => {
  let active = 0;
  let maxActive = 0;
  const env = {
    AI: {
      async run(_model, payload) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return {
          answer: JSON.stringify({
            transactions: [{ d: "2026-09-15", m: payload.image, a: 1000 }]
          })
        };
      }
    }
  };
  const values = await analyzeTransactionImport(env, {
    images: [
      "data:image/png;base64,AA==",
      "data:image/png;base64,BB=="
    ],
    today: "2026-09-16"
  });
  assert.equal(maxActive, 2);
  assert.equal(values.length, 2);
});

test("merchant normalization ignores punctuation and parenthetical text", () => {
  assert.equal(normalizeMerchant("스타벅스(세종점)"), "스타벅스");
});
