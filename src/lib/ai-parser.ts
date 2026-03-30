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
 * llama-3.1-8b-instant : en hızlı, günlük 500K token ücretsiz
 * llama-3.3-70b-versatile : daha kaliteli, biraz daha yavaş
 * mixtral-8x7b-32768    : geniş context window
 */
const GROQ_MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "mixtral-8x7b-32768",
];

/**
 * Gemini model önceliği.
 * gemini-1.5-flash : en geniş ücretsiz kota (bazı bölgelerde limit: 0 sorunu var)
 * gemini-1.5-pro   : daha yavaş, farklı kota havuzu
 * gemini-2.0-flash : bazı ülkelerde ücretsiz kota yok
 */
const GEMINI_MODELS = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"];

// ─── Sistem prompt ───────────────────────────────────────────────────────────

const buildPrompt = (structuredContent: string): string =>
  `Sen bir üniversite ders programı ayrıştırma uzmanısın.

Sana bir üniversitenin ders programı belgesi verildi. Her üniversitenin formatı farklıdır.
Belgeyi inceleyip TÜM dersleri doğru biçimde çıkarman gerekiyor.

━━━ BELGE FORMATLARI ━━━

FORMAT A — HAFTALIK DERS PROGRAMI (tablo/grid):
Sütunlar = günler (Pzt, Sal, Çar, Per, Cum), Satırlar = saatler (09:00, 10:00 vb.)
Her hücre = bir ders adı (boşsa o saatte ders yok)
SATIR BAŞLIĞI: "SÜRE" "GÜN" sütunlarını yoksay.
⚠️ Bu formatta tablonun ÜSTÜNDEKİ başlık satırına (ör. "1. SINIF HAFTALIK DERS PROGRAMI") bak.
   Başlıktan sınıf yılını al ve o tablodaki TÜM derslere uygula.
Örnek:
=== 2. SINIF HAFTALIK DERS PROGRAMI ===
SÜRE   | PAZARTESİ         | SALI              | ÇARŞAMBA
09-10  | Veri Yapıları     | -                 | Nesne Yönelimli
10-11  | Türk Dili         | İngilizce II      | -
→ Çıkar: Veri Yapıları (classYear:"2.S"), Nesne Yönelimli (classYear:"2.S"), Türk Dili (classYear:"2.S"), İngilizce II (classYear:"2.S")

FORMAT B — DERS LİSTESİ (satır bazlı):
Her satır bir ders. Sütunlar farklı sırada olabilir.
Sınıf yılı sütunu varsa kullan. Yoksa üstteki bölüm başlığından al.
Örnek:
=== 1. SINIF 1. YARIYIL ===
BLM101 | Programlamaya Giriş | Dr. Ali Yılmaz | Pzt | D101
BLM103 | Matematik I         | Prof. Ayşe Kaya | Sal | D202
→ Çıkar her ikisi için: classYear:"1.S"

FORMAT C — SAYFA/BÖLÜM BAZLI:
Excel'de her sayfa = bir sınıf veya bölüm (örn. sayfa adı: "1. Sınıf", "BLM-2")
Sayfa adından sınıf/bölüm bilgisini al.

FORMAT D — KARMA:
Başlık satırı var ya da yok, sütun sırası tahmin et.

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

${structuredContent}`;

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
          content:
            "Sen bir üniversite ders programı ayrıştırma asistanısın. " +
            "SADECE geçerli bir JSON dizisi döndür. " +
            "Başka hiçbir metin, açıklama veya sarma nesnesi ekleme. " +
            "Çıktın doğrudan [ ile başlamalı ve ] ile bitmeli. " +
            "classYear alanı için: belgedeki bölüm başlıklarından (ör. '2. SINIF', 'II. SINIF') sınıf yılını belirle ve o bölümdeki tüm derslere uygula. " +
            "Tek başına rakamlar (1, 2, 3, 4) kredi saati veya AKTS olabilir — bunları classYear olarak KULLANMA. " +
            "Sınıf yılını belirleyemiyorsan classYear değerini boş string (\"\") olarak bırak.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.05,
      max_tokens: 8192,
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

const callGroq = async (apiKey: string, prompt: string): Promise<string | null> => {
  let lastError = "";

  for (const model of GROQ_MODELS) {
    try {
      return await callGroqModel(apiKey, model, prompt);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      const isRetryable =
        lastError.includes("rate_limit") ||
        lastError.includes("overloaded") ||
        lastError.includes("529") ||
        lastError.includes("model") ||
        lastError.includes("not found") ||
        lastError.includes("decommissioned");

      if (!isRetryable) {
        throw new Error(`Groq API hatası: ${lastError}`);
      }
    }
  }

  throw new Error(`Groq API hatası: ${lastError}`);
};

// ─── Gemini çağrısı ──────────────────────────────────────────────────────────

const callGeminiModel = async (
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string | null> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.05,
        maxOutputTokens: 16384,
        responseMimeType: "application/json",
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

const callGemini = async (apiKey: string, prompt: string): Promise<string | null> => {
  let lastError = "";

  for (const model of GEMINI_MODELS) {
    try {
      return await callGeminiModel(apiKey, model, prompt);
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

  // 1. Önce doğrudan JSON ayrıştır (temiz JSON ise)
  const trimmed = raw.trim();
  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // 2. Regex ile JSON dizi bul (metin içine gömülü olabilir)
    const arrayMatch = raw.match(/\[[\s\S]*?\]/s) ?? raw.match(/\[[\s\S]*\]/);
    const objectMatch = raw.match(/\{[\s\S]*\}/);

    try {
      if (arrayMatch) {
        parsed = JSON.parse(arrayMatch[0]);
      } else if (objectMatch) {
        parsed = JSON.parse(objectMatch[0]);
      } else {
        console.warn("[AI Parser] JSON bulunamadı. Ham yanıt:", raw.slice(0, 300));
        return [];
      }
    } catch {
      console.warn("[AI Parser] JSON ayrıştırma hatası. Ham yanıt:", raw.slice(0, 300));
      return [];
    }
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

const truncate = (text: string): string =>
  text.length > MAX_CHARS
    ? text.slice(0, MAX_CHARS) + "\n\n[... belge kırpıldı, ilk kısım analiz edildi ...]"
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

  const prompt = buildPrompt(truncate(content));

  try {
    const responseText =
      provider === "groq"
        ? await callGroq(key, prompt)
        : await callGemini(key, prompt);

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
