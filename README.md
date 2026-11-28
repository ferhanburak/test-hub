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

Mobil (Expo) projeler `templates/mobile-project-ci.yml` ile `mobile-ci.yml` workflow'unu çağırır. Uygulamanın Jest testleri projenin kendi reposunda çalışır ve sonucu `test-results/test-hub-unit.json` dosyasına yazar; test-hub bunu projenin `tests/catalog/` kartlarıyla eşler. Kart ID'si testin adında ya da onu saran `describe` bloğunda geçebilir. Maestro uçtan uca akışları şimdilik lokalde çalışır. Bu akışların kartları `env: e2e-device` ile işaretlenir. Raporda "On device (local)" başlığı altında ayrı listelenir ve eksik test gibi görünmez. Durum ve tarih, karta yazılan son yerel koşudan gelir.

Cihazda koşudan sonra sonucu kartlara yazmak için test-hub klasöründen:

```powershell
node scripts/device-results.mjs --catalog <proje>/tests/catalog --junit <proje>/mobile/test-results/test-hub-maestro.xml
```

Betik yalnızca `env: e2e-device` kartlarının `status` ve `last_run` alanlarını günceller. Tarih, XML içindeki koşu zamanından (`timestamp`) alınır, yoksa dosyanın yazıldığı gündür; `--date YYYY-MM-DD` ile değiştirilebilir. Değişen kartlar projede commit edilir, sonraki CI raporu "Last run" sütununda bu tarihi gösterir. Kalan akış varsa betik 1 ile çıkar.

Uygulama dışındaki testler (ör. backend fonksiyonları, güvenlik kuralları) için `extra-test-script` verilir: workflow bu npm betiğini `extra-working-directory` klasöründe `npm ci` sonrası çalıştırır. Betik sonuçlarını `test-results/test-hub-*.json` (Jest/Vitest) ya da `test-hub-*.xml` (JUnit) olarak yazar. `node --test` için `--test-reporter=junit --test-reporter-destination=test-results/test-hub-<ad>.xml` yeterlidir; iç içe `describe` başlıkları JUnit'te `testsuite` adı olarak gelir, kart ID'si onlarda da geçebilir. Firebase Emulator Suite kullanan projeler `firebase-emulators: true` verir (Java 21 kurulur, emülatör indirmeleri önbelleğe alınır).

Supabase kullanan projeler `supabase: true` verir: workflow, Supabase CLI ile projenin `supabase/migrations` dosyalarını uygulanmış bir Postgres başlatır ve testlere `SUPABASE_DB_URL` ortam değişkenini verir. RLS testleri bu bağlantıyla `authenticated` ve `anon` rollerine geçip başka kullanıcının satırlarına erişmeyi dener. Docker gerektirdiği için bu testler lokalde `SUPABASE_DB_URL` yoksa atlanır.

## Bildirim

Kritik öncelikli bir test kaldığında açılan Issue repo sahibine atanır. GitHub Mobile, atanan işler için telefona anlık bildirim gönderir; bunun için uygulamada bildirimleri açmak yeterlidir. Diğer öncelikler ve kararsız testler atanmadan açılır. Repo sahibi atanamıyorsa (örneğin bir organizasyon) Issue atamasız açılır.

## Proje analizi (`/analyze`)

test-hub klasöründe açılan bir Claude Code oturumunda:

```
/analyze ../carfollow
```

1. `scripts/analyze.mjs` statik analiz yapar ve projenin `docs/analysis/` klasörüne `facts.json` ile `static.md` yazar. İçerik dosyalardan okunan kesin bilgilerdir: paketler ve çatılar, yapılandırma dosyaları, workflow'lar, Firestore koleksiyonları, Supabase tabloları (RLS ve politika sayısıyla), route ve ekranlar, ortam değişkenlerinin adları ve test/kart sayıları. Yalnızca git'te izlenen dosyalar okunur; `.env` dosyaları hiç açılmaz.
2. Claude bu bilgilerle aynı klasöre devir paketini (`README.md`), Mermaid diyagramlarını (`diagrams.md`) ve taslak test kartlarını (`draft-cards/`) yazar. Hepsi "Otomatik üretildi, kontrol edilmedi" satırıyla başlar.
3. Hiçbir şey commit edilmez. Taslak kartlar onaylanınca elle `tests/catalog/` klasörüne taşınır.

Proje belgeleri test-hub'a değil, projenin kendi reposuna yazılır; test-hub public bir repodur.

Yalnızca statik kısmı çalıştırmak için:

```powershell
node scripts/analyze.mjs --target ../carfollow
```

## Panel (`ui/`)

Projelerin test durumunu gösteren salt okunur bir React PWA. Veriyi tarayıcıdan doğrudan GitHub'dan okur:

- **Kartlar:** Katalogdan (projenin `tests/catalog/` klasörü ya da test-hub `catalog/<proje>/`) okunur.
- **Durum:** Açık `test-hub` Issue'su olan kart "kaldı" ya da "kararsız" görünür, diğerleri kartta yazan durumla görünür.
- **Proje sağlığı:** Ana daldaki son `test-hub.yml` koşusundan gelir.

Ekranlar:

- **Genel bakış:** Proje kartları.
- **Proje detayı:** Son koşular, durum filtreleri, kart tablosu, cihaz kartlarının son koşu tarihi.
- **Ayarlar:** GitHub token'ı.

Public projeler token olmadan görünür. Private projeler için salt okunur bir fine-grained token gerekir: Actions, Contents, Issues ve Metadata izinleri Read-only olmalı. Token yalnızca tarayıcıda saklanır ve sadece api.github.com'a gönderilir. Sayfanın kendisinde proje verisi yoktur.

Lokalde çalıştırmak için:

```powershell
npm --prefix ui ci
```

```powershell
npm --prefix ui run dev
```

Yayın: `ui-pages` workflow'u, ana dala gelen `ui/` değişikliklerinde paneli GitHub Pages'e yükler. Bunun için repoda bir kez Settings → Pages → Source: **GitHub Actions** seçilmelidir.
