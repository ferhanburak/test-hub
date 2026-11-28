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

## Proje analizi ve test üretimi (`/analyze`)

test-hub klasöründe açılan bir Claude Code oturumunda:

```
/analyze ../carfollow
```

Komut sırayla şunları yapar:

1. **Statik analiz.** `scripts/analyze.mjs` projenin `docs/analysis/` klasörüne `facts.json` ve `static.md` yazar. İçerik dosyalardan okunan kesin bilgilerdir: paketler, yapılandırma, Firestore koleksiyonları, Supabase tabloları ve RLS, route'lar, ortam değişkenlerinin adları, testler. Yalnızca git'te izlenen dosyalar okunur; `.env` dosyaları hiç açılmaz.
2. **Fonksiyon envanteri.** `functions.md` dosyasında her fonksiyonun ne yaptığı ve beklenen durumları (normal, sınır, hatalı girdi, yetki) listelenir, hangi kartın onu test ettiği de yazılır.
3. **Testler ve kartlar.** Testi olmayan riskli fonksiyonlar için gerçek testler yazılır, her biri kendi kart ID'siyle. Kartta `function`, `requirement` ile `## Amaç`, `## Beklenen` ve `## Adımlar` bölümleri bulunur. Bir koşuda en fazla 25 yeni kart yazılır.
4. **Çalıştırma ve rapor.** Testler çalıştırılır. `scripts/report.mjs --doc` tek parça `TEST-REPORT.md` üretir: özet, "Çözülmesi gerekenler" listesi ve her kart için amaç, beklenen durum, sonuç ve hata.
5. **Hatalar.** Testi yanlış olan düzeltilir. Kodda gerçek hata bulan test olduğu gibi kalır, kartına `needs_fix: true` ve bir `## Sorun` bölümü eklenir. Uygulama koduna dokunulmaz. Merge sonrası test-hub, kalan her test için `needs-fix` etiketli bir Issue açar.
6. **Belgeler.** `SRS.md` (ISO/IEC/IEEE 29148: fonksiyonel ve fonksiyonel olmayan gereksinimler, izlenebilirlik matrisi), `SDD.md` (IEEE 1016: mimari, bileşenler, veri, arayüzler, akışlar, güvenlik; Mermaid diyagramlarıyla) ve devir paketi `README.md` yazılır.

Yerelde hiçbir şey commit edilmez. Proje belgeleri test-hub'a değil, projenin kendi reposuna yazılır; test-hub public bir repodur.

CI'daki her test koşusu da aynı tek parça raporu (`TEST-REPORT.md`) üretir ve koşunun artifact'larına koyar.

Yalnızca statik kısmı çalıştırmak için:

```powershell
node scripts/analyze.mjs --target ../carfollow
```

Yerel sonuçlardan tek parça rapor üretmek için:

```powershell
node scripts/report.mjs --project mulakat-kocu --catalog ../mulakat-kocu/tests/catalog --unit ../mulakat-kocu/test-results/test-hub-unit.json --doc ../mulakat-kocu/docs/analysis/TEST-REPORT.md
```

## Zamanlanmış testler

Proje şablonlarında (`templates/*-project-ci.yml`) yorum satırı olarak bir `schedule` bloğu vardır. Açılırsa testler örneğin her pazartesi tam setle çalışır. Private repolarda bu Actions dakikası harcar.


## Panel (`ui/`)

Projelerin test durumunu gösteren salt okunur bir React PWA. Veriyi tarayıcıdan doğrudan GitHub'dan okur:

- **Kartlar:** Katalogdan (projenin `tests/catalog/` klasörü ya da test-hub `catalog/<proje>/`) okunur.
- **Durum:** Açık `test-hub` Issue'su olan kart "kaldı" ya da "kararsız" görünür, diğerleri kartta yazan durumla görünür.
- **Proje sağlığı:** Ana daldaki son `test-hub.yml` koşusundan gelir.

Ekranlar:

- **Genel bakış:** Proje kartları.
- **Proje detayı:** Son koşular, durum filtreleri, kart tablosu, cihaz kartlarının son koşu tarihi.
- **Release hazırlığı:** Her proje için "Hazır", "Uyarılarla hazır" ya da "Hazır değil". Kalan kritik test ya da başarısız son koşu release'i durdurur. Diğer kırıklar, kararsız testler, yazılmamış kritik testler ve 7 günden eski cihaz koşuları uyarıdır.
- **Not düşme:** Kalan bir testin satırında "Not ekle" ile Issue'ya yorum yazılır. Token'da Issues izninin Read and write olması gerekir.
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
