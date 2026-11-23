---
id: CLT-WEB-005
title: E-posta fonksiyonu geçerli mesajı gönderiyor
project: celtikci
line: web
type: automated
priority: critical
env: local
use_case: UC-01
status: passed
---

## Amaç

Formdan gelen mesajın doğru içerikle büroya iletildiğini doğrulamak.

## Adımlar

1. `api/contact.js` fonksiyonunu geçerli verilerle çağır.

## Beklenen sonuç

- Fonksiyon başarı döner ve tek bir e-posta hazırlar.
- Alıcı, yanıt adresi, konu ve metin doğrudur.
- `nodemailer` taklit edildiği için gerçek e-posta gönderilmez.
