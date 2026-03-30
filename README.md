# Sınav Programı Robotu

Üniversite sınav koordinatörleri için geliştirilmiş, tarayıcı tabanlı sürükle-bırak çizelgeleme aracı.
Excel, PDF ve Word kaynaklarından otomatik sınav taslağı çıkarır; çakışmaları canlı gösterir; isteğe bağlı yapay zeka desteğiyle akıllı planlama yapar.

---

## Özellikler

| Özellik | Açıklama |
|---|---|
| 📂 Dosya içe aktarma | Excel (`.xlsx`), PDF, Word (`.docx`) — sürükle-bırak veya dosya seç |
| 🤖 Otomatik planlama | Kural tabanlı veya AI destekli (Groq / Gemini) çakışmasız yerleştirme |
| 🔁 Yeniden oluştur | Mevcut kartları yeni kurallarla yeniden çizelgele |
| ⏰ Dinamik saat dilimi | Çakışma çözülemezse AI yeni saat dilimleri ekler |
| 🏛️ Okul profili | Bölüm, sınıf, derslik, hoca ve ders şablonları — adım adım sihirbaz |
| 👁️ Çakışma tespiti | Sınıf, hoca, derslik, kapasite ve süre çakışmaları renkli gösterim |
| 📊 Excel aktarımı | Sınav programını `.xlsx` olarak dışa aktar |
| 🖱️ Sürükle-bırak | Kartları slotlar arasında serbestçe taşı |
| 🗂️ Bölüm görünümleri | Her bölüm için ayrı filtre sekmesi |
| 💾 Kayıtlar | Birden fazla program kaydı, kayıt silme ve yeni belge açma |

---

## Gizlilik ve Güvenlik

> **Bu uygulama tamamen yerel çalışır. Hiçbir veriniz sunucuya gönderilmez.**

- Yüklediğiniz dosyalar (Excel, PDF, Word) **yalnızca tarayıcı belleğinde** işlenir, hiçbir yere kaydedilmez veya iletilmez.
- Sınav programları ve kayıtlar **yalnızca kendi tarayıcınızın `localStorage`'ına** yazılır; başka kimse erişemez.
- API anahtarınız (Groq veya Gemini) yalnızca profil kaydınızda saklanır ve **yalnızca ilgili API'ye** (Groq veya Google sunucuları) gönderilir — başka hiçbir yere değil.
- Bu repo'da **hiçbir kullanıcı verisi, API anahtarı veya yüklenen dosya** bulunmaz.

---

## Yapay Zeka Kurulumu (İsteğe Bağlı)

AI destekli ders tanıma ve akıllı çizelgeleme için bir API anahtarı gerekir.
**Ücretsiz** Groq API'si önerilir.

### Groq API Anahtarı (Önerilen — Ücretsiz)

Groq, Llama tabanlı modelleri ücretsiz kota ile sunar. Türkiye dahil her ülkeden kullanılabilir.

1. **[console.groq.com](https://console.groq.com)** adresine gidin.
2. Ücretsiz hesap oluşturun (Google veya GitHub ile hızlıca kayıt olabilirsiniz).
3. Sol menüden **"API Keys"** sekmesine tıklayın.
4. **"Create API Key"** butonuna basın, bir isim verin.
5. Oluşan anahtarı kopyalayın — `gsk_` ile başlar.
6. Uygulamada **"Okul profili" → "Temel Bilgiler"** adımındaki **"AI API Anahtarı"** alanına yapıştırın.
7. **"Profili Kaydet"** ile kaydedin.

> ⚠️ Groq'un ücretsiz katmanında günlük ve dakikalık istek limitleri vardır (dakikada 30 istek, günde ~14.400 istek). Normal kullanım için yeterlidir.

### Google Gemini API Anahtarı (Alternatif)

1. **[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)** adresine gidin.
2. Google hesabınızla giriş yapın.
3. **"Create API Key"** butonuna basın.
4. Oluşan anahtarı kopyalayın — `AIza` ile başlar.
5. Aynı şekilde profil paneline yapıştırın ve kaydedin.

> ℹ️ Gemini'nin ücretsiz kotası bazı ülkelerde sıfır olabilir. Türkiye'de sorun yaşıyorsanız Groq kullanın.

---

## Kurulum ve Geliştirme

### Gereksinimler

- Node.js 20+
- npm 10+

### Kurulum

```bash
git clone https://github.com/alparslanguvenc/sinav-programi-robotu.git
cd sinav-programi-robotu
npm install
```

### Web geliştirme sunucusu

```bash
npm run dev
```

Tarayıcıda `http://localhost:5173` adresini açın.

### Masaüstü uygulaması (Electron)

```bash
npm run dev:desktop
```

---

## Kullanım Kılavuzu

### 1. Okul profili oluşturun

Sağ panelde **"Okul profili"** bölümünü açın ve sihirbazı takip edin:

| Adım | İçerik |
|---|---|
| 0. Temel Bilgiler | Profil adı, sınav tarihleri, saatler, varsayılan süre, API anahtarı |
| 1. Bölümler | Fakültenin bölümleri (örn. Gazetecilik, Halkla İlişkiler) |
| 2. Sınıflar | Sınıf yılları (1.S, 2.S, 3.S, 4.S, Hazırlık) |
| 3. Derslikler | Derslik adı ve kapasitesi |
| 4. Hocalar | Öğretim üyesi listesi |
| 5. Dersler | Her ders için bölüm, sınıf, hoca ve derslik ataması |

### 2. Dosya yükleyin

Toolbar'dan **"Dosya yükle"** butonuna tıklayın ya da dosyayı doğrudan sürükleyip bırakın.
Desteklenen formatlar: **Excel (.xlsx)**, **PDF**, **Word (.docx)**

### 3. Sınav programını inceleyin

- Kartları sürükleyerek slotları değiştirin.
- Sağ tıklama ile sınav süresini veya seçmeli grubunu ayarlayın.
- Çakışmalar otomatik olarak tespit edilir ve renkle gösterilir.
- **"Yeniden oluştur"** ile AI çakışmaları gidererek yeniden planlama yapar.

### 4. Excel'e aktarın

**"Excel aktar"** butonu ile programı `.xlsx` formatında indirin.

---

## Seçmeli Ders Grupları

Aynı seçmeli dersi alan öğrenciler farklı bölümlerde olabilir. Bu durumda:

- Karta sağ tıklayın → **"Seçmeli grup"** alanına grup adı girin (örn. `seçmeli-a`).
- Aynı gruptaki dersler arasında sınıf çakışması uyarısı verilmez.

---

## Test ve Kalite

```bash
npm run lint          # ESLint
npm run test:unit     # Vitest birim testleri
npm run test:e2e      # Playwright uçtan uca testleri
```

---

## Masaüstü Paketleme

```bash
npm run package:mac   # macOS DMG
npm run package:win   # Windows EXE (NSIS)
```

Çıktılar `release/` klasörüne yazılır.

---

## Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| Arayüz | React 19 + TypeScript |
| Durum yönetimi | Zustand 5 |
| Sürükle-bırak | dnd-kit |
| Derleme | Vite 7 |
| Masaüstü | Electron |
| AI | Groq (Llama) / Google Gemini |
| Dosya okuma | xlsx, pdfjs-dist, mammoth |
| Excel aktarım | xlsx |

---

## Katkıda Bulunma

Pull request ve issue'lar memnuniyetle karşılanır.
Büyük değişiklikler için önce bir issue açmanız önerilir.

---

## Lisans

MIT
