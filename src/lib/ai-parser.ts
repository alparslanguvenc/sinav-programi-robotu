/**
 * AI entegrasyonu — ders programı dosyalarından akıllı ders çıkarma.
 *
 * Desteklenen sağlayıcılar:
 *  • Groq  (gsk_... ile başlayan key) — ücretsiz, Türkiye dahil her ülke, Llama modelleri
 *  • Gemini (AIza... ile başlayan key) — bazı bölgelerde ücretsiz kota sıfır
 *
 * Key formatından sağlayıcı otomatik seçilir.
 */

export type CourseSeed = {
  programs: string[];
  classYear: string;
  courseName: string;
  instructorText: string | null;
  locationText: string | null;
};

export type SheetData = {
  name: string;
  rows: string[][];
};

export type AIScheduleConstraint = {
  kind: "pin-date" | "avoid-time" | "deadline" | "day-score" | "date-position";
  subjects?: string[];
  classYears?: string[];
  scope?: "all" | "others";
  dateStr?: string;
  timeStr?: string;
  dayKey?: string;
  positionFromEnd?: number;
  weight?: number;
};

export type AIScheduleInstructionPlan = {
  constraints: AIScheduleConstraint[];
  groupSecondForeignByClassYear: boolean;
};

// ─── Gemini tipleri ─────────────────────────────────────────────────────────

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string; code?: number };
}

// ─── Groq tipleri ───────────────────────────────────────────────────────────

interface GroqResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
  error?: { message?: string };
}

type ModelCallOptions = {
  systemPrompt: string;
  maxOutputTokens: number;
  jsonObjectMode?: boolean;
};

// ─── Sağlayıcı tespiti ──────────────────────────────────────────────────────

type Provider = "groq" | "gemini";

const detectProvider = (apiKey: string): Provider => {
  const k = apiKey.trim();
  if (k.startsWith("gsk_")) return "groq";
  return "gemini"; // AIza... veya bilinmeyen → Gemini dene
};

// ─── Model listeleri ─────────────────────────────────────────────────────────

/**
 * Groq model önceliği.
 * 2025-05-22 tarihli Groq changelog'unda mixtral-8x7b-32768 kaldırıldı.
 * Burada yalnızca güncel production model ID'lerini tutuyoruz.
 * llama-3.1-8b-instant   : en hızlı genel amaçlı seçenek
 * qwen/qwen3-32b         : çok dilli metin ayrıştırmada güçlü ara fallback
 * llama-3.3-70b-versatile: daha kaliteli, biraz daha yavaş
 * openai/gpt-oss-20b     : ek üretim fallback'i
 */
const GROQ_MODELS = [
  "llama-3.1-8b-instant",
  "qwen/qwen3-32b",
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-20b",
];

/**
 * Gemini model önceliği.
 * gemini-1.5-flash : en geniş ücretsiz kota (bazı bölgelerde limit: 0 sorunu var)
 * gemini-1.5-pro   : daha yavaş, farklı kota havuzu
 * gemini-2.0-flash : bazı ülkelerde ücretsiz kota yok
 */
const GEMINI_MODELS = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"];

// ─── Sistem prompt ───────────────────────────────────────────────────────────

const buildPrompt = (structuredContent: string, userInstructions?: string): string =>
  `Sen bir üniversite ders programı ayrıştırma uzmanısın.

Sana bir üniversitenin ders programı belgesi verildi. Her üniversitenin formatı farklıdır.
Belgeyi inceleyip TÜM dersleri doğru biçimde çıkarman gerekiyor.

━━━ BELGE FORMATLARI ━━━

FORMAT A — GÜN×SAAT TABLOSU:
Sütunlar = günler (Pzt, Sal, Çar, Per, Cum), Satırlar = saatler.
Tablonun ÜSTÜNDEKI başlık (ör. "2. SINIF HAFTALIK DERS PROGRAMI") → tüm derslere o sınıf yılını ata.
Örnek:
=== 2. SINIF ===
SÜRE  | PAZARTESİ     | SALI
09-10 | Veri Yapıları | -
→ Çıkar: Veri Yapıları (classYear:"2.S")

FORMAT B — DERS LİSTESİ (satır bazlı):
Her satır bir ders; üstteki bölüm başlığından sınıf yılını al.
Örnek:
=== 1. SINIF 1. YARIYIL ===
BLM101 | Programlamaya Giriş | Dr. Ali Yılmaz
→ classYear:"1.S"

FORMAT C — SAYFA BAZLI (Excel):
Her sayfa adı = sınıf/bölüm ("1. Sınıf", "Seyahat 2" vb.)

FORMAT D — DERSLİK×SAAT TABLOSU (önemli):
Satırlar = derslikler/sınıflar (101, 102, Lab vb.), Sütunlar = saat dilimleri.
Her hücre = o derslikte o saatte verilen ders (ders adı + hoca adı birlikte).
Belge başlığı veya sayfa adı hangi sınıf yılı olduğunu söyler.

  ⚠️ Bu formatta SADECE hücre içeriğini ders olarak al.
     Sütun başlıkları (8:10-8:55, 9:00-9:45 gibi saatler) DERS DEĞİL, atla.
     Satır başlıkları (101, 102, Lab gibi derslik adları) DERS DEĞİL, locationText olarak kullan.

  Sınıf yılı belirleme — DERSLİK×SAAT formatı için öncelik sırası:
  1. Belge/sayfa başlığı: "Seyahat 1"→"1.S", "Seyahat 2"→"2.S", "Seyahat 3"→"3.S", "Seyahat 4"→"4.S"
  2. Ders adındaki Romen rakamı (bahar dönemi kuralı):
     I veya II  → "1.S"
     III veya IV → "2.S"
     V veya VI  → "3.S"
     VII veya VIII → "4.S"
  3. Belirsizse: ""

FORMAT E — KARMA: Yukarıdakilerden birini tahmin et.

━━━ ALAN TANIMLAMA KURALLARI ━━━

DERS ADI (courseName):
✓ Anlamlı Türkçe/İngilizce metin: "Veri Yapıları", "Calculus I", "İşletmeye Giriş"
✓ "Giriş", "Temel", "İleri", "Uygulamalı", "Laboratuvar" içerebilir
✗ Ders kodu DEĞİL: BLM101, MAT-201, 3IK105 — bunlar kod, isim değil
✗ Gün adları DEĞİL: Pazartesi, Monday, Pzt
✗ Saat DEĞİL: 09:00, 10-11, "2 saat"

ÖĞRETİM ÜYESİ (instructorText):
✓ Unvan içerir: Prof.Dr., Doç.Dr., Dr., Öğr.Gör., Arş.Gör., Yrd.Doç.Dr.
✓ Ad Soyad kombinasyonu
✓ Örnek: "Prof.Dr. Ahmet Yılmaz", "Öğr.Gör. Fatma Demir", "Dr. Can Ak"
✗ Yoksa: null

DERSLİK (locationText):
✓ Sayı-harf kombinasyonu: D101, A-201, B304, Z01
✓ Özel isimler: "Amfi 1", "Konferans Salonu", "Bilgisayar Lab.", "Lab-2"
✓ Sadece sayı: "101", "204"
✗ Yoksa: null

SINIF YILI (classYear) — SADECE açık bir sınıf belirteci varsa doldur:

Bölüm başlığından veya sayfa adından al:
"1. Sınıf" / "Birinci Sınıf" / "I. Sınıf" / "1. YIL" / "1. YARIYIL" veya "2. YARIYIL" → "1.S"
"2. Sınıf" / "İkinci Sınıf"  / "II. Sınıf" / "2. YIL" / "3. YARIYIL" veya "4. YARIYIL" → "2.S"
"3. Sınıf" / "Üçüncü Sınıf" / "III. Sınıf" / "3. YIL" / "5. YARIYIL" veya "6. YARIYIL" → "3.S"
"4. Sınıf" / "Dördüncü Sınıf"/ "IV. Sınıf" / "4. YIL" / "7. YARIYIL" veya "8. YARIYIL" → "4.S"
"Hazırlık" / "Prep" → "Hazırlık"

⛔ KESİNLİKLE YAPMA:
- Tek başına rakam ("1", "2", "3", "4") — bunlar kredi saati, AKTS, T/U/K sütunu olabilir
- Ders kodundan tahmin etme: "BLM101" → classYear değil
- Emin değilsen: "" (boş string) kullan — asla tahmin etme, asla "1.S" atama

Bir bölüm başlığı altındaki TÜM dersler o başlığın sınıf yılını alır.
Belge birden fazla sınıf bölümü içeriyorsa her bölümdeki dersler kendi sınıf yılını alır.

BÖLÜM/PROGRAM (programs):
✓ Akademik program adı: "Bilgisayar Mühendisliği", "Gazetecilik", "İşletme"
✓ Sayfa adı veya başlık satırından çıkar
✓ Yoksa: []

━━━ ÇIKARMA STRATEJİSİ ━━━

1. Önce belgenin formatını belirle (A/B/C/D)
2. Bölüm başlıklarını ve sayfa adlarını tara — sınıf yılı ve bölüm bilgisini not et
3. Her bölüm altındaki derslere o bölümün sınıf yılını ata
4. Her dersi tek tek çıkar — atlamadan, tekrarsız
5. Aynı ders birden fazla bölümde görünüyorsa programs dizisine hepsini ekle
6. Emin olmadığın alanlar için null / "" kullan, tahmin etme

━━━ ÇIKTI ━━━

Sadece geçerli JSON dizisi döndür. Başka metin, açıklama, kod bloğu EKLEME.

Örnek çıktı (birden fazla sınıf):
[
  {
    "programs": ["Bilgisayar Mühendisliği"],
    "classYear": "1.S",
    "courseName": "Matematik I",
    "instructorText": null,
    "locationText": null
  },
  {
    "programs": ["Bilgisayar Mühendisliği"],
    "classYear": "2.S",
    "courseName": "Veri Yapıları ve Algoritmalar",
    "instructorText": "Dr. Mehmet Yıldız",
    "locationText": "D201"
  }
]

━━━ DERS PROGRAMI BELGESİ ━━━

${structuredContent}${
  userInstructions?.trim()
    ? `\n\n━━━ KULLANICININ EK TALİMATLARI ━━━\n\n${userInstructions.trim()}\n\nBu talimatlara ders çıkarma sürecinde dikkat et.`
    : ""
}`;

const buildInstructionPrompt = (
  courseSeeds: CourseSeed[],
  dates: string[],
  times: string[],
  userInstructions: string,
): string => {
  const classYearMap = new Map<string, string[]>();

  for (const seed of courseSeeds) {
    const classYear = seed.classYear.trim() || "(belirsiz)";
    const entries = classYearMap.get(classYear) ?? [];

    if (!entries.includes(seed.courseName)) {
      entries.push(seed.courseName);
      classYearMap.set(classYear, entries);
    }
  }

  const classYearSummary = [...classYearMap.entries()]
    .map(
      ([classYear, courseNames]) =>
        `- ${classYear}: ${courseNames
          .slice(0, 10)
          .map((courseName) => courseName.slice(0, 48))
          .join("; ")}`,
    )
    .join("\n");

  return `Sen bir üniversite sınav planlama talimatı ayrıştırma asistanısın.

Görevin: kullanıcının doğal dilde yazdığı sınav planlama talimatını, mevcut scheduler'ın anlayacağı yapılandırılmış JSON kısıtlarına çevirmek.

Sadece geçerli bir JSON nesnesi döndür. Kod bloğu, açıklama, markdown veya ek metin yazma.

Şema:
{"constraints":[{"kind":"pin-date|avoid-time|deadline|day-score|date-position","subjects":["..."],"classYears":["1.S"],"scope":"all|others","dateStr":"14.05.2026","timeStr":"09:00","dayKey":"çarşamba","positionFromEnd":0,"weight":250}],"groupSecondForeignByClassYear":false}

Kısa kurallar:
- "son gün" => kind:"date-position", positionFromEnd:0, weight:340
- "sondan bir önceki gün" => kind:"date-position", positionFromEnd:1, weight:320
- "... tarihine kadar tamamlansın" => kind:"deadline", dateStr:"DD.MM.YYYY", weight:-300
- "... tarihinde olsun" => kind:"pin-date", dateStr:"DD.MM.YYYY", weight:250
- Belirli bir tarihten kaçınma varsa kind:"pin-date", weight:-250 kullan
- Belirli saatten kaçınma varsa kind:"avoid-time", weight:-300 kullan
- Belirli saati tercih etme varsa kind:"avoid-time", weight:80 kullan
- Belirli günü tercih etme => kind:"day-score", weight:70
- Belirli günden kaçınma => kind:"day-score", weight:-200
- Genel İngilizce için subjects içine "__english_general__" yaz
- Mesleki İngilizce için "__vocational_english__"
- Almanca için "__german__"
- Rusça için "__russian__"
- Japonca için "__japanese__"
- İkinci yabancı dil grubu için "__second_foreign__"
- Çok özel ders adı belirtilirse subjects alanına küçük harfli ders adı parçası yazabilirsin
- "diğer sınıflar" benzeri ifade varsa scope:"others" kullan, aksi halde "all"
- classYears alanında sadece bağlamda görülen sınıf değerlerini kullan
- İkinci yabancı dil sınavlarının aynı gün/saatte olabileceğini, seçmeli olduklarını veya bir öğrencinin iki ikinci yabancı dil alamayacağını anlatan talimat varsa groupSecondForeignByClassYear:true yap
- Talimatta açıkça olmayan hiçbir kısıt uydurma
- Emin değilsen boş dizi döndür: {"constraints":[],"groupSecondForeignByClassYear":false}

Mevcut tarih seçenekleri:
${dates.map((date) => `- ${date}`).join("\n") || "- (tanımlı tarih yok)"}

Mevcut saat seçenekleri:
${times.map((time) => `- ${time}`).join("\n") || "- (tanımlı saat yok)"}

Bilinen sınıflar ve dersler:
${classYearSummary || "- (ders listesi yok)"}

Kullanıcı talimatı:
${userInstructions.trim()}`;
};

// ─── Excel → yapılandırılmış tablo ──────────────────────────────────────────

/**
 * Excel sayfalarını AI'ın okuyabileceği yapılandırılmış tablo formatına çevirir.
 */
export const formatSheetsForAI = (sheets: SheetData[]): string => {
  if (sheets.length === 0) return "";

  return sheets
    .map((sheet) => {
      if (sheet.rows.length === 0) return `=== SAYFA: ${sheet.name} ===\n(boş)`;

      const colCount = Math.max(...sheet.rows.map((row) => row.length));
      const colWidths = Array.from({ length: colCount }, (_, colIdx) => {
        const maxLen = Math.max(
          colIdx.toString().length + 3,
          ...sheet.rows.map((row) => Math.min((row[colIdx] ?? "").length, 30)),
        );
        return Math.min(maxLen, 30);
      });

      const lines: string[] = [`=== SAYFA: ${sheet.name} ===`];
      const header = colWidths.map((w, i) => `[${i}]`.padEnd(w)).join(" | ");
      lines.push(header);
      lines.push("─".repeat(header.length));

      sheet.rows.slice(0, 200).forEach((row, rowIdx) => {
        const cells = colWidths.map((w, colIdx) => {
          const cell = (row[colIdx] ?? "").slice(0, 30);
          return cell.padEnd(w);
        });
        lines.push(`[${String(rowIdx).padStart(3)}] ${cells.join(" | ")}`);
      });

      return lines.join("\n");
    })
    .join("\n\n");
};

const formatRawTextForAI = (rawText: string): string => {
  if (!rawText.trim()) return "";
  return `=== HAM METİN ===\n${rawText.trim()}`;
};

// ─── Groq çağrısı ────────────────────────────────────────────────────────────

const callGroqModel = async (
  apiKey: string,
  model: string,
  prompt: string,
  options: ModelCallOptions,
): Promise<string | null> => {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          // Sistem mesajı: modele net görev ve çıktı formatı ver
          role: "system",
          content: options.systemPrompt,
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.05,
      max_tokens: options.maxOutputTokens,
      ...(options.jsonObjectMode ? { response_format: { type: "json_object" } } : {}),
      // json_object KULLANMA — dizi döndürmemizi engeller
    }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as GroqResponse | null;
    const errorMsg = errorBody?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(errorMsg);
  }

  const data = (await response.json()) as GroqResponse;
  return data.choices?.[0]?.message?.content ?? null;
};

const COURSE_EXTRACTION_SYSTEM_PROMPT =
  "Sen bir üniversite ders programı ayrıştırma asistanısın. " +
  "SADECE geçerli bir JSON dizisi döndür. " +
  "Başka hiçbir metin, açıklama veya sarma nesnesi ekleme. " +
  "Çıktın doğrudan [ ile başlamalı ve ] ile bitmeli. " +
  "classYear alanı için: belgedeki bölüm başlıklarından (ör. '2. SINIF', 'II. SINIF') sınıf yılını belirle ve o bölümdeki tüm derslere uygula. " +
  "Tek başına rakamlar (1, 2, 3, 4) kredi saati veya AKTS olabilir — bunları classYear olarak KULLANMA. " +
  "Sınıf yılını belirleyemiyorsan classYear değerini boş string (\"\") olarak bırak.";

const INSTRUCTION_SYSTEM_PROMPT =
  "Sen bir sınav planlama talimatı ayrıştırma asistanısın. " +
  "SADECE geçerli bir JSON nesnesi döndür. Açıklama yazma. " +
  "Yalnızca açıkça istenen kısıtları üret ve şemaya uy.";

const callGroq = async (
  apiKey: string,
  prompt: string,
  options: ModelCallOptions,
): Promise<string | null> => {
  const attempts: Array<{ model: string; error: string }> = [];

  const isRetryableGroqError = (message: string) => {
    const normalized = message.toLocaleLowerCase("en");
    return (
      normalized.includes("rate_limit") ||
      normalized.includes("overloaded") ||
      normalized.includes("timeout") ||
      normalized.includes("timed out") ||
      normalized.includes("temporarily unavailable") ||
      normalized.includes("unavailable") ||
      normalized.includes("529") ||
      normalized.includes("model") ||
      normalized.includes("not found") ||
      normalized.includes("not supported") ||
      normalized.includes("decommissioned")
    );
  };

  for (const model of GROQ_MODELS) {
    try {
      return await callGroqModel(apiKey, model, prompt, options);
    } catch (err) {
      const lastError = err instanceof Error ? err.message : String(err);
      attempts.push({ model, error: lastError });

      if (!isRetryableGroqError(lastError)) {
        throw new Error(`Groq API hatası: ${model} -> ${lastError}`);
      }
    }
  }

  const summary = attempts
    .map(({ model, error }) => `${model} -> ${error}`)
    .join(" | ");

  throw new Error(`Groq API hatası: Tüm modeller başarısız oldu. ${summary}`);
};

// ─── Gemini çağrısı ──────────────────────────────────────────────────────────

const callGeminiModel = async (
  apiKey: string,
  model: string,
  prompt: string,
  options: ModelCallOptions,
): Promise<string | null> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.05,
        maxOutputTokens: options.maxOutputTokens,
        responseMimeType: "application/json",
      },
      systemInstruction: {
        parts: [{ text: options.systemPrompt }],
      },
    }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as GeminiResponse | null;
    const errorMsg = errorBody?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(errorMsg);
  }

  const data = (await response.json()) as GeminiResponse;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
};

const callGemini = async (
  apiKey: string,
  prompt: string,
  options: ModelCallOptions,
): Promise<string | null> => {
  let lastError = "";

  for (const model of GEMINI_MODELS) {
    try {
      return await callGeminiModel(apiKey, model, prompt, options);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      const isRetryable =
        lastError.toLowerCase().includes("quota") ||
        lastError.includes("RESOURCE_EXHAUSTED") ||
        lastError.includes("limit: 0") ||
        lastError.includes("403") ||
        lastError.includes("not found") ||
        lastError.includes("not supported");

      if (!isRetryable) {
        throw new Error(`Gemini API hatası: ${lastError}`);
      }
    }
  }

  throw new Error(`Gemini API hatası: ${lastError}`);
};

const parseJsonPayload = (raw: string): unknown => {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const arrayMatch = raw.match(/\[[\s\S]*?\]/s) ?? raw.match(/\[[\s\S]*\]/);
    const objectMatch = raw.match(/\{[\s\S]*\}/);

    try {
      if (arrayMatch) {
        return JSON.parse(arrayMatch[0]);
      }

      if (objectMatch) {
        return JSON.parse(objectMatch[0]);
      }
    } catch {
      return null;
    }
  }

  return null;
};

const parseAIInstructionPlan = (raw: string): AIScheduleInstructionPlan => {
  const parsed = parseJsonPayload(raw);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { constraints: [], groupSecondForeignByClassYear: false };
  }

  const obj = parsed as Record<string, unknown>;
  const constraints = Array.isArray(obj.constraints) ? obj.constraints : [];

  return {
    constraints: constraints.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return [];
      }

      const entry = item as Record<string, unknown>;
      const kind = typeof entry.kind === "string" ? entry.kind.trim() : "";

      if (
        kind !== "pin-date" &&
        kind !== "avoid-time" &&
        kind !== "deadline" &&
        kind !== "day-score" &&
        kind !== "date-position"
      ) {
        return [];
      }

      const subjects = Array.isArray(entry.subjects)
        ? entry.subjects.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];

      const classYears = Array.isArray(entry.classYears)
        ? entry.classYears.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];

      const dateValue =
        typeof entry.dateStr === "string"
          ? entry.dateStr
          : typeof entry.date === "string"
            ? entry.date
            : typeof entry.targetDate === "string"
              ? entry.targetDate
              : undefined;
      const timeValue =
        typeof entry.timeStr === "string"
          ? entry.timeStr
          : typeof entry.time === "string"
            ? entry.time
            : undefined;
      const dayValue =
        typeof entry.dayKey === "string"
          ? entry.dayKey
          : typeof entry.day === "string"
            ? entry.day
            : undefined;

      return [
        {
          kind,
          subjects,
          classYears,
          scope: entry.scope === "others" ? "others" : "all",
          dateStr: typeof dateValue === "string" ? dateValue.trim() : undefined,
          timeStr: typeof timeValue === "string" ? timeValue.trim() : undefined,
          dayKey: typeof dayValue === "string" ? dayValue.trim() : undefined,
          positionFromEnd:
            typeof entry.positionFromEnd === "number" && Number.isFinite(entry.positionFromEnd)
              ? entry.positionFromEnd
              : undefined,
          weight:
            typeof entry.weight === "number" && Number.isFinite(entry.weight)
              ? entry.weight
              : undefined,
        } satisfies AIScheduleConstraint,
      ];
    }),
    groupSecondForeignByClassYear: obj.groupSecondForeignByClassYear === true,
  };
};

// ─── Yanıt ayrıştırma ────────────────────────────────────────────────────────

/**
 * AI yanıtından CourseSeed dizisini çıkarır.
 * Desteklenen formatlar:
 *   [...] — dizi
 *   { "courses": [...] } — nesne içinde dizi (Groq sıklıkla bu formatı üretir)
 *   { "course_name": "..." } — tek nesne (nadir)
 */
const parseAIResponse = (raw: string): CourseSeed[] => {
  // Debug: konsola yazdır (geliştirme/sorun giderme için)
  console.debug("[AI Parser] Ham yanıt (ilk 500 karakter):", raw.slice(0, 500));

  let parsed = parseJsonPayload(raw);

  if (parsed === null) {
    console.warn("[AI Parser] JSON ayrıştırma hatası. Ham yanıt:", raw.slice(0, 300));
    return [];
  }

  // 3. Nesne içinde dizi ara: { courses: [...] } veya { data: [...] } vb.
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const arr = Object.values(obj).find((v) => Array.isArray(v));
    if (arr) {
      parsed = arr;
    } else if (
      // Tek ders nesnesi ise diziye çevir
      typeof obj.courseName === "string"
    ) {
      parsed = [obj];
    } else {
      console.warn("[AI Parser] Nesne içinde dizi bulunamadı:", JSON.stringify(obj).slice(0, 200));
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  return (parsed as unknown[])
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).courseName === "string" &&
        ((item as Record<string, unknown>).courseName as string).trim().length > 1,
    )
    .map((item) => ({
      programs: Array.isArray(item.programs)
        ? (item.programs as unknown[])
            .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
            .map((p) => p.trim())
        : [],
      classYear: typeof item.classYear === "string" ? item.classYear.trim() : "",
      courseName: (item.courseName as string).trim(),
      instructorText:
        typeof item.instructorText === "string" && item.instructorText.trim().length > 1
          ? item.instructorText.trim()
          : null,
      locationText:
        typeof item.locationText === "string" && item.locationText.trim().length > 0
          ? item.locationText.trim()
          : null,
    }));
};

// ─── Token sınırı ─────────────────────────────────────────────────────────────

/** ~35K karakter ≈ ~8-10K token — her iki sağlayıcının ücretsiz kotasında rahat çalışır. */
const MAX_CHARS = 35_000;
const MAX_INSTRUCTION_CHARS = 6_000;

const truncate = (text: string): string =>
  text.length > MAX_CHARS
    ? text.slice(0, MAX_CHARS) + "\n\n[... belge kırpıldı, ilk kısım analiz edildi ...]"
    : text;

const truncateInstruction = (text: string): string =>
  text.length > MAX_INSTRUCTION_CHARS
    ? text.slice(0, MAX_INSTRUCTION_CHARS) + "\n\n[... talimat bağlamı kısaltıldı ...]"
    : text;

// ─── Ana fonksiyon ───────────────────────────────────────────────────────────

/**
 * AI ile ders programından ders listesi çıkarır.
 * API key formatından sağlayıcı otomatik seçilir:
 *   gsk_...  → Groq  (ücretsiz, Türkiye dahil her ülke)
 *   AIza...  → Gemini (bazı bölgelerde ücretsiz kota sıfır)
 *
 * @param apiKey  - Groq (gsk_...) veya Gemini (AIza...) API anahtarı
 * @param sheets  - Excel sayfaları (varsa)
 * @param rawText - PDF/Word ham metni (varsa)
 */
export const parseCoursesWithAI = async (
  apiKey: string,
  sheets: SheetData[],
  rawText: string,
  userInstructions?: string,
): Promise<{ seeds: CourseSeed[]; error: string | null; provider: Provider }> => {
  const key = apiKey.trim();

  if (!key) {
    return { seeds: [], error: "API anahtarı belirtilmemiş.", provider: "gemini" };
  }

  const provider = detectProvider(key);

  // İçerik hazırlığı
  const parts: string[] = [];
  if (sheets.length > 0) parts.push(formatSheetsForAI(sheets));
  if (rawText.trim()) parts.push(formatRawTextForAI(rawText));
  const content = parts.join("\n\n");

  if (content.trim().length < 20) {
    return { seeds: [], error: "Dosya içeriği çok kısa, analiz edilemedi.", provider };
  }

  const prompt = buildPrompt(truncate(content), userInstructions);

  try {
    const responseText =
      provider === "groq"
        ? await callGroq(key, prompt, {
            systemPrompt: COURSE_EXTRACTION_SYSTEM_PROMPT,
            maxOutputTokens: 8192,
            jsonObjectMode: false,
          })
        : await callGemini(key, prompt, {
            systemPrompt: COURSE_EXTRACTION_SYSTEM_PROMPT,
            maxOutputTokens: 16384,
          });

    if (!responseText) {
      return { seeds: [], error: "AI boş yanıt döndü.", provider };
    }

    const seeds = parseAIResponse(responseText);

    if (seeds.length === 0) {
      // Ham yanıtın ilk 200 karakterini hata mesajına ekle — kullanıcı ne döndüğünü görsün
      const preview = responseText.replace(/\s+/g, " ").slice(0, 200);
      return {
        seeds: [],
        error: `AI ders çıkaramadı. Model yanıtı: "${preview}…"`,
        provider,
      };
    }

    return { seeds, error: null, provider };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);

    // Kota/bölge hatası için özel mesaj
    const isQuota =
      raw.toLowerCase().includes("quota") ||
      raw.toLowerCase().includes("resource_exhausted") ||
      raw.includes("limit: 0");

    let message = raw;

    if (isQuota && provider === "gemini") {
      message =
        "Gemini ücretsiz kotası bu hesapta aktif değil (bölge kısıtlaması). " +
        "Groq API'yi deneyin: console.groq.com adresinden ücretsiz anahtar alın (gsk_... ile başlar).";
    } else if (isQuota && provider === "groq") {
      message = "Groq günlük kota doldu. Birkaç dakika bekleyip tekrar deneyin.";
    }

    return { seeds: [], error: message, provider };
  }
};

export const interpretSchedulingInstructionsWithAI = async (
  apiKey: string,
  courseSeeds: CourseSeed[],
  dates: string[],
  times: string[],
  userInstructions: string,
): Promise<{ plan: AIScheduleInstructionPlan; error: string | null; provider: Provider }> => {
  const key = apiKey.trim();

  if (!key) {
    return {
      plan: { constraints: [], groupSecondForeignByClassYear: false },
      error: "API anahtarı belirtilmemiş.",
      provider: "gemini",
    };
  }

  if (!userInstructions.trim()) {
    return {
      plan: { constraints: [], groupSecondForeignByClassYear: false },
      error: null,
      provider: detectProvider(key),
    };
  }

  const provider = detectProvider(key);
  const prompt = truncateInstruction(buildInstructionPrompt(courseSeeds, dates, times, userInstructions));

  try {
    const responseText =
      provider === "groq"
        ? await callGroq(key, prompt, {
            systemPrompt: INSTRUCTION_SYSTEM_PROMPT,
            maxOutputTokens: 900,
            jsonObjectMode: true,
          })
        : await callGemini(key, prompt, {
            systemPrompt: INSTRUCTION_SYSTEM_PROMPT,
            maxOutputTokens: 1200,
          });

    if (!responseText) {
      return {
        plan: { constraints: [], groupSecondForeignByClassYear: false },
        error: "AI boş yanıt döndü.",
        provider,
      };
    }

    const rawPayload = parseJsonPayload(responseText);
    const plan = parseAIInstructionPlan(responseText);

    if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
      return {
        plan: { constraints: [], groupSecondForeignByClassYear: false },
        error: "AI talimatları geçerli bir JSON nesnesi olarak döndürmedi.",
        provider,
      };
    }

    if (plan.constraints.length === 0 && !plan.groupSecondForeignByClassYear) {
      return {
        plan,
        error: "AI talimatlardan yapılandırılmış kısıt çıkaramadı.",
        provider,
      };
    }

    return { plan, error: null, provider };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const isQuota =
      raw.toLowerCase().includes("quota") ||
      raw.toLowerCase().includes("resource_exhausted") ||
      raw.includes("limit: 0");

    let message = raw;

    if (isQuota && provider === "gemini") {
      message =
        "Gemini ücretsiz kotası bu hesapta aktif değil (bölge kısıtlaması). " +
        "Groq API'yi deneyin: console.groq.com adresinden ücretsiz anahtar alın (gsk_... ile başlar).";
    } else if (isQuota && provider === "groq") {
      message = "Groq günlük kota doldu. Birkaç dakika bekleyip tekrar deneyin.";
    }

    return {
      plan: { constraints: [], groupSecondForeignByClassYear: false },
      error: message,
      provider,
    };
  }
};
