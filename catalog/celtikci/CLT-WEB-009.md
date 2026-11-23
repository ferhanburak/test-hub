---
id: CLT-WEB-009
title: Özel karakterli ad Reply-To adresini bozmuyor
project: celtikci
line: web
type: automated
priority: high
env: local
use_case: UC-01
status: passed
---

## Amaç

Büro maili yanıtladığında cevabın formu dolduran ziyaretçiye gitmesini sağlamak.

## Adımlar

1. Fonksiyonu virgül, e-posta benzeri metin veya tırnak içeren adlarla çağır.

## Beklenen sonuç

- Reply-To adı ve adresi ayrı alanlar olarak verilir.
- Ad alanındaki metin yanıt adresini değiştiremez.
