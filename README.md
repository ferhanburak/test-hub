# test-hub

Birden fazla web ve mobil projeyi tek merkezden test eden, belgeleyen ve takip eden sistem.

- **Otomatik testler:** Vitest, Playwright, Jest, Maestro; ortak GitHub Actions workflow'ları
- **Test kataloğu:** Her testin ID'si ve belgesi (`catalog/`)
- **Sorun takibi:** Kırılan testler için otomatik GitHub Issue
- **Otomatik belgeleme:** Koddan belge, diyagram ve devir paketi
- **Panel:** Web (PWA) ve masaüstü (Electron)

Durum: kurulum aşamasında.

## Çeltikci testlerini lokalde çalıştırma

Çeltikci reposu `../celtikci-law-firm` altında ve build alınmış olmalı. Başka bir yerdeyse `HUB_TARGET_DIR` ile göster.

```powershell
npm ci
npx playwright install chromium
$env:HUB_PROJECT = 'celtikci'; $env:HUB_SUITE = 'all'; npm run test:e2e
npm run report -- --project celtikci
```

`HUB_SUITE`: `local` (form istekleri yakalanır), `live` (salt okunur canlı kontrol), `all`.

Yeni bir web projesini bağlamak için `templates/web-project-ci.yml` dosyasını o projenin `.github/workflows/` klasörüne kopyala.
