#!/usr/bin/env node
// Sends a Telegram message when a critical test newly breaks or is fixed.
// Reads the summary written by `issues.mjs --summary`, so a test that keeps
// failing is reported once (when its issue opens), not on every run.
// Usage: node scripts/notify.mjs --project celtikci --summary path --results path --unit path
//        node scripts/notify.mjs --ping   (sends a test message)
// Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID; without them it does nothing.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadResults, readCards } from './lib/hub.mjs';
import { sanitizeError } from './issues.mjs';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_ERROR_LENGTH = 300;

function firstLine(text) {
  const line = sanitizeError(text).split(/\r?\n/).find((part) => part.trim()) ?? '';
  return line.length > MAX_ERROR_LENGTH ? `${line.slice(0, MAX_ERROR_LENGTH)}…` : line.trim();
}

// Picks the cards worth a message: newly failed (not flaky) and fixed ones at the given priorities.
export function selectChanges({ summary, cards, results, priorities = ['critical'] }) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const pick = (ids) =>
    (ids ?? []).map((id) => cardsById.get(id)).filter((card) => card && priorities.includes(card.priority));
  const broken = pick(summary.opened)
    .filter((card) => results.get(card.id)?.status === 'failed')
    .map((card) => ({ id: card.id, title: card.title, error: firstLine(results.get(card.id).errors[0] ?? '') }));
  const fixed = pick(summary.closed).map((card) => ({ id: card.id, title: card.title }));
  return { broken, fixed };
}

export function buildMessage({ project, repo, branch, sha, runUrl, broken, fixed }) {
  const lines = [];
  const where = [repo, branch, sha?.slice(0, 7)].filter(Boolean).join(' · ');
  if (broken.length) {
    lines.push(`🔴 test-hub: ${project} — ${broken.length} kritik test kırıldı`);
    if (where) lines.push(where);
    lines.push('');
    for (const item of broken) {
      lines.push(`• ${item.id} ${item.title}`);
      if (item.error) lines.push(`  ${item.error}`);
    }
  }
  if (fixed.length) {
    if (lines.length) lines.push('');
    lines.push(`🟢 test-hub: ${project} — ${fixed.length} kritik test düzeldi`);
    if (!broken.length && where) lines.push(where);
    if (!broken.length) lines.push('');
    for (const item of fixed) lines.push(`• ${item.id} ${item.title}`);
  }
  if (runUrl) lines.push('', `Koşu: ${runUrl}`);
  const text = lines.join('\n');
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
}

// Never puts the token in an error message: the request URL contains it.
export async function sendTelegram({ token, chatId, text, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!response.ok) {
    let reason = '';
    try {
      reason = (await response.json())?.description ?? '';
    } catch {
      // Body is not JSON; the status code is enough.
    }
    throw new Error(`Telegram sendMessage failed: ${response.status}${reason ? ` ${reason}` : ''}`);
  }
}

export async function notify({ env, args, fetchImpl = fetch, log = console.log }) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    log('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, skipping Telegram notification.');
    return 'skipped';
  }
  if (args.ping) {
    await sendTelegram({ token, chatId, text: 'test-hub: Telegram bildirimi çalışıyor.', fetchImpl });
    log('Test message sent.');
    return 'sent';
  }
  if (!args.summary || !fs.existsSync(args.summary)) {
    log('No issue sync summary found, skipping Telegram notification.');
    return 'skipped';
  }

  const summary = JSON.parse(fs.readFileSync(args.summary, 'utf8'));
  const { results } = loadResults({ playwright: args.results, unit: args.unit });
  const cards = readCards(args.project, args.catalog);
  const { broken, fixed } = selectChanges({ summary, cards, results, priorities: args.priority });
  if (!broken.length && !fixed.length) {
    log('No critical test changed state, nothing to send.');
    return 'quiet';
  }

  const server = env.GITHUB_SERVER_URL || 'https://github.com';
  const runUrl = env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
    ? `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : '';
  const text = buildMessage({
    project: args.project,
    repo: env.GITHUB_REPOSITORY,
    branch: env.GITHUB_REF_NAME,
    sha: env.GITHUB_SHA,
    runUrl,
    broken,
    fixed,
  });
  await sendTelegram({ token, chatId, text, fetchImpl });
  log(`Telegram notification sent: ${broken.length} broken, ${fixed.length} fixed.`);
  return 'sent';
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      project: { type: 'string', default: 'celtikci' },
      summary: { type: 'string' },
      results: { type: 'string', default: 'reports/results.json' },
      unit: { type: 'string', multiple: true, default: ['reports/unit.json'] },
      catalog: { type: 'string' },
      priority: { type: 'string', multiple: true, default: ['critical'] },
      ping: { type: 'boolean', default: false },
    },
  });
  await notify({ env: process.env, args });
}

// A failed notification is a warning, not a failed test run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.log(`::warning::${error.message}`);
  });
}
