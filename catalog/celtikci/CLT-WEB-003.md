---
id: CLT-WEB-003
title: İletişim formu geçersiz veriyi reddediyor
project: celtikci
line: web
type: automated
priority: high
env: local
use_case: UC-01
status: passed
---

## Amaç

Eksik veya hatalı bilgiyle gönderim yapılmasını önlemek.

## Adımlar

1. İletişim sayfasını aç, formu boş gönder.
2. Ad ve mesajı doldur, geçersiz e-posta yazıp gönder.

## Beklenen sonuç

- Zorunlu alanlar ve e-posta geçersiz sayılır.
- Serverless fonksiyona istek gitmez.
- Başarı mesajı görünmez.
