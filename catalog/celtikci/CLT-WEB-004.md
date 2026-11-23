---
id: CLT-WEB-004
title: Canlı site smoke testi
project: celtikci
line: web
type: automated
priority: critical
env: production
use_case: UC-02
status: passed
---

## Amaç

celtikci.av.tr adresinin ayakta olduğunu ve iletişim sayfasının doğrudan açıldığını tam set çalıştırıldığında doğrulamak.

## Adımlar

1. Canlı ana sayfayı aç.
2. `/iletisim` adresini doğrudan aç.

## Beklenen sonuç

- İki sayfa da başarılı yanıt döner.
- Form görünür ve gönder düğmesi etkindir.
- Form gönderilmez, yazma isteği yapılmaz, e-posta gitmez.
