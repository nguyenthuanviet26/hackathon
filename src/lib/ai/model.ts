// model.ts — the call to the AI provider.
//
// Mock by default, so the demo runs with no network and no key. Set a real key in `.env` and the
// same code path calls the provider instead.
//
// This module only ever receives text that `redact()` has already been through. It is the last
// stop before the data leaves the company, so it does three things and nothing else: send, read
// the answer, return it. It never logs the prompt — a provider log and an application log are two
// copies of the same thing to leak.

export type ModelMode = "mock" | "anthropic";

export function modelMode(): ModelMode {
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock";
}

/** What the model was asked and what it answered. Both are already redacted. */
export interface ModelReply {
  answer: string;
  mode: ModelMode;
  model: string;
}

const MOCK_MODEL = "worksafe-mock-1";

/**
 * The mock. It deliberately echoes the placeholders back, because that is the thing worth seeing
 * in a demo: the model can only talk about `[SĐT_1]`, never about the customer's real number.
 */
function mockAnswer(prompt: string): string {
  const placeholders = [...prompt.matchAll(/\[(?:SĐT|EMAIL|CCCD|THE_CARD|KHACH_HANG)_\d+\]/g)].map((m) => m[0]);
  const unique = [...new Set(placeholders)];
  const first = (kind: string) => unique.find((p) => p.startsWith(`[${kind}_`));

  // A draft reply written only in terms of the labels, the way a real model has to.
  const name = first("KHACH_HANG");
  const contact = [first("SĐT"), first("EMAIL")].filter(Boolean).join(" hoặc ");
  const draft = [
    `Kính gửi ${name ?? "Quý khách"},`,
    "",
    "Chúng tôi thành thật xin lỗi vì đơn hàng của Quý khách được giao chậm hơn cam kết.",
    contact
      ? `Bộ phận chăm sóc khách hàng sẽ liên hệ Quý khách qua ${contact} trong hôm nay để xác nhận thời gian giao và phương án bồi thường.`
      : "Bộ phận chăm sóc khách hàng sẽ liên hệ Quý khách trong hôm nay để xác nhận thời gian giao và phương án bồi thường.",
    "",
    "Trân trọng,",
  ];

  const lines = ["(mô hình mô phỏng: chưa gọi nhà cung cấp AI nào)", "", ...draft];
  if (unique.length > 0) {
    lines.push("", `Mô hình chỉ thấy các nhãn ${unique.join(", ")}, không thấy giá trị thật.`);
  }
  return lines.join("\n");
}

async function anthropicAnswer(prompt: string): Promise<ModelReply> {
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system:
        "Bạn là trợ lý nội bộ của một công ty. Dữ liệu khách hàng trong câu hỏi đã được che và " +
        "thay bằng các nhãn như [KHACH_HANG_1], [SĐT_1], [EMAIL_1], [CCCD_1]. Hãy trả lời bằng chính các nhãn đó; " +
        "không suy đoán, không bịa ra giá trị thật đằng sau một nhãn.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    // The provider's error text can quote the request back, so it does not go into the message.
    throw new Error(`AI provider refused the request (HTTP ${res.status})`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const answer = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();

  return { answer: answer || "(nhà cung cấp AI trả về nội dung rỗng)", mode: "anthropic", model };
}

/** Ask the model. `prompt` must already be redacted — this function does not check. */
export async function askModel(prompt: string): Promise<ModelReply> {
  if (modelMode() === "anthropic") return anthropicAnswer(prompt);
  return { answer: mockAnswer(prompt), mode: "mock", model: MOCK_MODEL };
}
