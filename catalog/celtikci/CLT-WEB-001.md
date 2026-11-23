---
id: CLT-WEB-001
title: İletişim formu doğru verilerle gönderiliyor
project: celtikci
line: web
type: automated
priority: critical
env: local
use_case: UC-01
status: passed
---

## Amaç

Ziyaretçinin büroya ulaşmasının ana yolu iletişim formu. Form bozulursa müşteri kaybı olur ve kimse fark etmez.

## Adımlar

1. Ana sayfayı aç, iletişim bölümüne git.
2. Ad, e-posta ve mesaj alanlarını geçerli verilerle doldur.
3. Gönder'e bas.

## Beklenen sonuç

- Serverless fonksiyona tek bir istek gider, gövdesinde girilen alanlar vardır.
- Kullanıcıya başarı mesajı gösterilir.
- Test sırasında gerçek e-posta gönderilmez (istek yakalanır).

## Notlar

Örnek kart. Formatın şablonu olarak kullan.
