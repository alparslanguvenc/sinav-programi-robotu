# Sınav Programı Robotu

Sınav Programı Robotu, sınav koordinatörleri için geliştirilen sürükle-bırak çizelgeleme aracıdır. Excel, PDF ve Word kaynaklarından sınav taslağı çıkarabilir; kurum profilleri ile ders, sınıf, hoca ve derslik bilgilerini saklayabilir; çakışmaları canlı gösterebilir.

## Geliştirme

```bash
npm install
npm run dev
```

Masaüstü uygulaması olarak geliştirme için:

```bash
npm run dev:desktop
```

## Test ve kalite

```bash
npm run lint
npm run test:unit
npm run test:e2e
```

## Masaüstü paketleri

macOS için sürükle-bırak kurulum DMG:

```bash
npm run package:mac
```

Windows için NSIS tabanlı EXE:

```bash
npm run package:win
```

Çıktılar `release/` klasörüne yazılır.

## GitHub Actions

`.github/workflows/build-desktop.yml` şu akışı kurar:

- `workflow_dispatch` ile isteğe bağlı paketleme
- `v*` etiketi push edildiğinde macOS DMG ve Windows EXE üretimi
- etiketli çalıştırmalarda draft GitHub release oluşturma

Repo private ise release ve artifact erişimi de private kalır.

## Notlar

- Word tarafında güvenilir format `.docx` dosyalarıdır.
- Eski `.doc` dosyaları için belgeyi `.docx` olarak yeniden kaydedip yükleyin.
