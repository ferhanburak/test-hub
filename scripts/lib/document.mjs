// One Markdown document for a whole test run: a summary, the tests that need
// fixing, then every card with its purpose, expected behaviour and result.
import { isDeviceCard } from './hub.mjs';

const STATUS = {
  passed: 'geçti',
  failed: 'kaldı',
  flaky: 'kararsız',
  skipped: 'atlandı',
  'not-written': 'yazılmadı',
  running: 'koşuyor',
};
const PRIORITY = { critical: 'kritik', high: 'yüksek', medium: 'orta', normal: 'normal', low: 'düşük' };
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'normal', 'low'];
const MAX_ERROR = 1500;
const SECRET_RE = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}/g;

const label = (status) => STATUS[status] ?? status ?? '—';
const cleanError = (text) =>
  String(text)
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(SECRET_RE, '[redacted]')
    .replace(/```/g, "'''")
    .trim()
    .slice(0, MAX_ERROR);
const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const byPriority = (a, b) =>
  (PRIORITY_ORDER.indexOf(a.priority) + 1 || 99) - (PRIORITY_ORDER.indexOf(b.priority) + 1 || 99) || a.id.localeCompare(b.id);

// A card needs fixing when its test failed in this run, or when it is marked
// `needs_fix: true` (a known bug the test documents).
export const needsFix = (row) => row.current === 'failed' || row.needs_fix === 'true';

export function renderTestDocument({ project, rows, results, orphans = [], meta = {} }) {
  const counts = {};
  for (const row of rows) counts[row.current] = (counts[row.current] ?? 0) + 1;
  const toFix = rows.filter(needsFix).sort(byPriority);
  const criticalFailed = rows.filter((row) => row.priority === 'critical' && row.current === 'failed');
  const verdict = criticalFailed.length
    ? 'Kritik testlerden kalan var; release önerilmez.'
    : toFix.length
      ? 'Kritik testler geçiyor; düzeltilecek başka sorunlar var.'
      : 'Bütün çalışan testler geçti.';

  const lines = [
    `# Test raporu: ${project}`,
    '',
    `> Otomatik üretildi${meta.date ? ` · ${meta.date}` : ''}${meta.commit ? ` · commit \`${meta.commit.slice(0, 7)}\`` : ''}${meta.runUrl ? ` · [koşu](${meta.runUrl})` : ''}`,
    '',
    '## Özet',
    '',
    verdict,
    '',
    '| Durum | Sayı |',
    '| --- | --- |',
    ...Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `| ${label(status)} | ${count} |`),
    `| **toplam** | **${rows.length}** |`,
    '',
    '## Çözülmesi gerekenler',
    '',
  ];

  if (toFix.length) {
    lines.push('| ID | Test | Öncelik | Fonksiyon | Sorun |', '| --- | --- | --- | --- | --- |');
    for (const row of toFix) {
      const error = results.get(row.id)?.errors?.[0];
      const problem = error ? cleanError(error).split('\n')[0] : row.sections?.Sorun?.split('\n')[0] ?? 'Bilinen hata';
      lines.push(
        `| [${row.id}](#${row.id.toLowerCase()}) | ${cell(row.title)} | ${PRIORITY[row.priority] ?? row.priority ?? '—'} | ${cell(row.function ?? '—')} | ${cell(problem)} |`,
      );
    }
  } else {
    lines.push('Yok.');
  }

  lines.push('', '## Testler', '');
  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const result = results.get(row.id);
    lines.push(`### ${row.id}`, '', `**${row.title ?? ''}**`, '');
    const facts = [
      `- **Durum:** ${label(row.current)}${needsFix(row) ? ' · çözülmesi gerekiyor' : ''}`,
      `- **Öncelik:** ${PRIORITY[row.priority] ?? row.priority ?? '—'}`,
    ];
    if (row.function) facts.push(`- **Fonksiyon:** \`${row.function}\``);
    if (row.requirement) facts.push(`- **Gereksinim:** ${row.requirement}`);
    if (row.env) facts.push(`- **Ortam:** ${row.env}${isDeviceCard(row) ? ` · son cihaz koşusu: ${row.last_run || 'hiç'}` : ''}`);
    if (!result && !isDeviceCard(row)) facts.push('- **Bu koşuda:** çalışmadı');
    lines.push(...facts, '');
    for (const [heading, title] of [
      ['Amaç', 'Amaç'],
      ['Beklenen', 'Beklenen durum'],
      ['Adımlar', 'Adımlar'],
    ]) {
      if (row.sections?.[heading]) lines.push(`**${title}**`, '', row.sections[heading], '');
    }
    if (result?.errors?.length) {
      lines.push('**Hata**', '', '```text', cleanError(result.errors[0]), '```', '');
    } else if (row.needs_fix === 'true' && row.sections?.Sorun) {
      lines.push('**Bilinen sorun**', '', row.sections.Sorun, '');
    }
  }

  if (orphans.length) {
    lines.push('## Kartı olmayan testler', '', 'Bu testlerin adında kart ID\'si var ama kartı yok:', '', ...orphans.map((id) => `- ${id}`), '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
