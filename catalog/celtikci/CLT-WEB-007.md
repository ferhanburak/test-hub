---
id: CLT-WEB-007
title: E-posta fonksiyonu geçersiz isteği reddediyor
project: celtikci
line: web
type: automated
priority: high
env: local
use_case: UC-01
status: passed
---

## Amaç

Tarayıcı doğrulaması atlansa bile eksik veya hatalı verinin e-postaya dönüşmesini önlemek.

## Adımlar

1. Fonksiyonu GET ile çağır.
2. Eksik ad, geçersiz e-posta, eksik mesaj ve boş gövdeyle çağır.

## Beklenen sonuç

- GET için 405, geçersiz veri için 422 döner.
- E-posta hazırlanmaz.
