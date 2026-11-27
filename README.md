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

## Mobil projeler

Mobil (Expo) projeler `templates/mobile-project-ci.yml` ile `mobile-ci.yml` workflow'unu çağırır. Uygulamanın Jest testleri projenin kendi reposunda çalışır ve sonucu `test-results/test-hub-unit.json` dosyasına yazar; test-hub bunu projenin `tests/catalog/` kartlarıyla eşler. Kart ID'si testin adında ya da onu saran `describe` bloğunda geçebilir. Maestro uçtan uca akışları şimdilik lokalde çalışır.

Uygulama dışındaki testler (ör. backend fonksiyonları, güvenlik kuralları) için `extra-test-script` verilir: workflow bu npm betiğini `extra-working-directory` klasöründe `npm ci` sonrası çalıştırır. Betik sonuçlarını `test-results/test-hub-*.json` (Jest/Vitest) ya da `test-hub-*.xml` (JUnit) olarak yazar. `node --test` için `--test-reporter=junit --test-reporter-destination=test-results/test-hub-<ad>.xml` yeterlidir; iç içe `describe` başlıkları JUnit'te `testsuite` adı olarak gelir, kart ID'si onlarda da geçebilir. Firebase Emulator Suite kullanan projeler `firebase-emulators: true` verir (Java 21 kurulur, emülatör indirmeleri önbelleğe alınır).

Supabase kullanan projeler `supabase: true` verir: workflow, Supabase CLI ile projenin `supabase/migrations` dosyalarını uygulanmış bir Postgres başlatır ve testlere `SUPABASE_DB_URL` ortam değişkenini verir. RLS testleri bu bağlantıyla `authenticated` ve `anon` rollerine geçip başka kullanıcının satırlarına erişmeyi dener. Docker gerektirdiği için bu testler lokalde `SUPABASE_DB_URL` yoksa atlanır.
