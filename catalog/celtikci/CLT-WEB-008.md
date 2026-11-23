---
id: CLT-WEB-008
title: SMTP hatası güvenli hata mesajı döndürüyor
project: celtikci
line: web
type: automated
priority: critical
env: local
use_case: UC-01
status: passed
---

## Amaç

Mail sunucusu hata verdiğinde ziyaretçinin bilgilendirilmesini ve sunucu ayrıntılarının sızmamasını sağlamak.

## Adımlar

1. Taklit SMTP gönderimini hata verecek şekilde ayarla.
2. Fonksiyonu geçerli verilerle çağır.

## Beklenen sonuç

- Fonksiyon 500 ve başarısız sonuç döner.
- Yanıtta şifre, sunucu adresi veya ham hata metni bulunmaz.
- Hata sunucu günlüğüne yazılır.
