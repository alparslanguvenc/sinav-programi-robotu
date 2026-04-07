import { afterEach, describe, expect, it, vi } from "vitest";
import { interpretSchedulingInstructionsWithAI, parseCoursesWithAI } from "../lib/ai-parser";

const okJsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const errorJsonResponse = (message: string, status = 400) =>
  new Response(
    JSON.stringify({
      error: { message },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );

describe("ai parser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries Groq with the next active model when an earlier one is unavailable", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(errorJsonResponse("Model unavailable for this project"))
      .mockResolvedValueOnce(
        okJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    programs: ["Gazetecilik"],
                    classYear: "1.S",
                    courseName: "Arkeoloji",
                    instructorText: "Dr. Ayşe Kaya",
                    locationText: "102",
                  },
                ]),
              },
            },
          ],
        }),
      );

    const result = await parseCoursesWithAI("gsk_test_key", [], "Arkeoloji dersi Dr. Ayşe Kaya 102");

    expect(result.error).toBeNull();
    expect(result.provider).toBe("groq");
    expect(result.seeds).toHaveLength(1);

    const requestedModels = fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      return body.model;
    });

    expect(requestedModels).toEqual(["llama-3.1-8b-instant", "qwen/qwen3-32b"]);
    expect(requestedModels).not.toContain("mixtral-8x7b-32768");
  });

  it("returns a combined Groq error summary after all active models fail", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(errorJsonResponse("The requested model is not available for your project"))
      .mockResolvedValueOnce(errorJsonResponse("Model unavailable for this project"))
      .mockResolvedValueOnce(errorJsonResponse("rate_limit exceeded", 429))
      .mockResolvedValueOnce(errorJsonResponse("temporarily unavailable", 503));

    const result = await parseCoursesWithAI("gsk_test_key", [], "Turizmde Halkla Iliskiler 102");

    expect(result.seeds).toEqual([]);
    expect(result.provider).toBe("groq");
    expect(result.error).toContain("Tüm modeller başarısız oldu");
    expect(result.error).toContain("llama-3.1-8b-instant");
    expect(result.error).toContain("qwen/qwen3-32b");
    expect(result.error).toContain("llama-3.3-70b-versatile");
    expect(result.error).toContain("openai/gpt-oss-20b");
    expect(result.error).not.toContain("mixtral-8x7b-32768");
  });

  it("parses scheduling constraints with AI into structured JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      okJsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                constraints: [
                  {
                    kind: "date-position",
                    subjects: ["__english_general__"],
                    classYears: ["1.S"],
                    scope: "all",
                    positionFromEnd: 0,
                    weight: 340,
                  },
                  {
                    kind: "pin-date",
                    subjects: ["__german__", "__russian__", "__japanese__"],
                    classYears: ["1.S"],
                    scope: "all",
                    dateStr: "14.05.2026",
                    weight: 250,
                  },
                ],
                groupSecondForeignByClassYear: true,
              }),
            },
          },
        ],
      }),
    );

    const result = await interpretSchedulingInstructionsWithAI(
      "gsk_test_key",
      [
        {
          programs: ["Seyahat"],
          classYear: "1.S",
          courseName: "İngilizce II",
          instructorText: null,
          locationText: null,
        },
      ],
      ["Çar 14.05.2026", "Per 15.05.2026"],
      ["09:00", "11:00"],
      "İngilizce son gün, ikinci yabancı diller 14.05.2026 tarihinde olsun.",
    );

    expect(result.error).toBeNull();
    expect(result.provider).toBe("groq");
    expect(result.plan.groupSecondForeignByClassYear).toBe(true);
    expect(result.plan.constraints).toHaveLength(2);
    expect(result.plan.constraints[0]?.kind).toBe("date-position");
    expect(result.plan.constraints[1]?.dateStr).toBe("14.05.2026");

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      max_tokens: number;
      model: string;
      response_format?: { type: string };
    };
    expect(body.max_tokens).toBe(900);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("returns a clear error when instruction AI responds with code instead of JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      okJsonResponse({
        choices: [
          {
            message: {
              content:
                'Aşağıdaki kod, kullanıcı talimatını ayrıştırarak geçerli bir JSON nesnesi döndürür.\n```python\nimport json\n```',
            },
          },
        ],
      }),
    );

    const result = await interpretSchedulingInstructionsWithAI(
      "gsk_test_key",
      [
        {
          programs: ["Seyahat"],
          classYear: "1.S",
          courseName: "İngilizce II",
          instructorText: null,
          locationText: null,
        },
      ],
      ["Çar 14.05.2026", "Per 15.05.2026"],
      ["09:00", "11:00"],
      "İngilizce son gün olsun.",
    );

    expect(result.plan.constraints).toEqual([]);
    expect(result.error).toBe("AI talimatları geçerli bir JSON nesnesi olarak döndürmedi.");
  });
});
