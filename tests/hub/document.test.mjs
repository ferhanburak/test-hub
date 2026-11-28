import { describe, expect, test } from 'vitest';
import { cardSections } from '../../scripts/lib/hub.mjs';
import { needsFix, renderTestDocument } from '../../scripts/lib/document.mjs';

describe('cardSections', () => {
  test('splits the body by level-two headings', () => {
    const body = '\r\n## Amaç\r\n\r\nGiriş korunuyor.\r\n\r\n## Beklenen\r\n\r\n- 401 döner\r\n- kayıt yazılmaz\r\n### Not\r\niç başlık\r\n';
    expect(cardSections(body)).toEqual({
      Amaç: 'Giriş korunuyor.',
      Beklenen: '- 401 döner\n- kayıt yazılmaz\n### Not\niç başlık',
    });
  });
});

describe('renderTestDocument', () => {
  const rows = [
    {
      id: 'MLK-MOB-002',
      title: 'Profil yalnız sahibine açık',
      priority: 'critical',
      current: 'failed',
      function: 'supabase/migrations/profiles.sql',
      requirement: 'FR-004',
      env: 'ci-supabase',
      sections: { Amaç: 'RLS başkasının satırını saklamalı.', Beklenen: '- B, A satırını göremez' },
    },
    { id: 'MLK-MOB-001', title: 'Gizli anahtar yok', priority: 'critical', current: 'passed', sections: {} },
    {
      id: 'MLK-MOB-009',
      title: 'Misafir ilerlemesi taşınıyor',
      priority: 'high',
      current: 'passed',
      needs_fix: 'true',
      sections: { Sorun: 'İki cihazda çevrimdışı yazma diğerini eziyor.' },
    },
    { id: 'MLK-MOB-012', title: 'Ana akış', priority: 'medium', current: 'passed', env: 'e2e-device', last_run: '2026-11-28', sections: {} },
  ];
  const results = new Map([
    ['MLK-MOB-002', { status: 'failed', errors: ['Expected 0 rows, got 1 | token ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa\n    at test.ts:3'] }],
    ['MLK-MOB-001', { status: 'passed', errors: [] }],
    ['MLK-MOB-009', { status: 'passed', errors: [] }],
  ]);
  const doc = renderTestDocument({
    project: 'mulakat-kocu',
    rows,
    results,
    orphans: ['MLK-MOB-099'],
    meta: { date: '2026-11-28', commit: 'abcdef1234', runUrl: 'https://github.com/o/r/actions/runs/1' },
  });

  test('starts with a verdict and counts', () => {
    expect(doc).toContain('# Test raporu: mulakat-kocu');
    expect(doc).toContain('> Otomatik üretildi · 2026-11-28 · commit `abcdef1` · [koşu](https://github.com/o/r/actions/runs/1)');
    expect(doc).toContain('Kritik testlerden kalan var; release önerilmez.');
    expect(doc).toContain('| geçti | 3 |');
    expect(doc).toContain('| kaldı | 1 |');
    expect(doc).toContain('| **toplam** | **4** |');
  });

  test('lists failed and known-bug tests to fix, critical first', () => {
    const section = doc.split('## Çözülmesi gerekenler')[1].split('## Testler')[0];
    const ids = [...section.matchAll(/\[(MLK-MOB-\d{3})\]/g)].map((match) => match[1]);
    expect(ids).toEqual(['MLK-MOB-002', 'MLK-MOB-009']);
    expect(section).toContain('Expected 0 rows, got 1 \\| token [redacted]');
    expect(section).toContain('İki cihazda çevrimdışı yazma diğerini eziyor.');
  });

  test('documents every card with expected behaviour and result', () => {
    expect(doc).toContain('### MLK-MOB-002\n\n**Profil yalnız sahibine açık**');
    expect(doc).toContain('- **Durum:** kaldı · çözülmesi gerekiyor');
    expect(doc).toContain('- **Fonksiyon:** `supabase/migrations/profiles.sql`');
    expect(doc).toContain('- **Gereksinim:** FR-004');
    expect(doc).toContain('**Beklenen durum**\n\n- B, A satırını göremez');
    expect(doc).toContain('```text\nExpected 0 rows');
    expect(doc).toContain('- **Ortam:** e2e-device · son cihaz koşusu: 2026-11-28');
    expect(doc).toContain('**Bilinen sorun**');
    expect(doc).not.toContain('ghp_');
    expect(doc).toContain('## Kartı olmayan testler');
  });

  test('says when nothing needs fixing', () => {
    const clean = renderTestDocument({ project: 'p', rows: [rows[1]], results });
    expect(clean).toContain('Bütün çalışan testler geçti.');
    expect(clean.split('## Çözülmesi gerekenler')[1]).toMatch(/^\n\nYok\./);
  });

  test('needsFix covers failures and marked bugs', () => {
    expect(needsFix({ current: 'failed' })).toBe(true);
    expect(needsFix({ current: 'passed', needs_fix: 'true' })).toBe(true);
    expect(needsFix({ current: 'flaky' })).toBe(false);
  });
});
