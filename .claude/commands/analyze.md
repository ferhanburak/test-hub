---
description: Analyse a project and write docs, Mermaid diagrams and draft test cards into its docs/analysis folder
argument-hint: <project folder, e.g. ../carfollow>
---

Analyse the project at `$ARGUMENTS` and document it. Talk to the user in Turkish; write the documents in Turkish.

## Rules

- Never open, read or quote `.env` files, keys, tokens, service account files or other secrets. Write only the **names** of environment variables.
- Everything goes into the project's own `docs/analysis/` folder. Nothing about the project is written into test-hub: test-hub is a public repository.
- Do not commit, push or change any code. The user reviews the output first.
- Draft test cards never go into `tests/catalog/`; they stay in `docs/analysis/draft-cards/` until the user approves them.

## Steps

1. If `$ARGUMENTS` is empty, ask which project folder to analyse. Check that the folder exists.
2. Run the static analysis from the test-hub folder:
   `node scripts/analyze.mjs --target "$ARGUMENTS"`
   It writes `docs/analysis/facts.json` and `docs/analysis/static.md` in the project. These are certain facts read from files.
3. If `docs/analysis/README.md` already exists and has an `analyzed_commit` value, run `git -C "$ARGUMENTS" diff --name-only <analyzed_commit> HEAD` and focus on the changed files. Update only the parts they affect.
4. Read `facts.json`, then the files it points to: package.json files, config files, Firestore rules or Supabase migrations, route and screen files, the main modules and the existing tests. Read enough to understand the main flows, not every file.
5. Write these files in `$ARGUMENTS/docs/analysis/`. Each one starts with the line `> Otomatik üretildi, kontrol edilmedi.`:
   - `README.md`: the handover pack. It starts with frontmatter `analyzed_commit: <git rev-parse HEAD>` and `analyzed_at: <YYYY-MM-DD>`, then these sections: genel bakış, mimari, lokalde çalıştırma (environment variable names only), kod haritası, veri modeli ve güvenlik kuralları, deploy, test durumu (cards, tests and which cards have no test), bilinen sorunlar ve riskler.
   - `diagrams.md`: Mermaid diagrams, each with a one-line note on its source and reliability:
     - Architecture (C4 context and container, as `flowchart`): from config and dependencies. **Kesin.**
     - Class or component diagram (`classDiagram`): from types, classes and component structure. **Kesin.**
     - ERD (`erDiagram`): from types, rules or migrations and collection paths. **Çıkarım.**
     - Sequence diagrams (`sequenceDiagram`) for the two or three most important flows. **Çıkarım.**
     - Use cases (`flowchart` with actors): from auth roles, routes and screens. **Yorum.**
   - `draft-cards/<ID>.md`: draft test cards for important behaviour that has no card or test yet. Use the project's existing card format and ID scheme (`<PROJE>-<HAT>-<NO>`, continuing after the highest number in `tests/catalog/`), with `status: not-written` and `draft: true` in the frontmatter. Each card has a short "Amaç" and "Adımlar" section. Prefer use cases and sequence flows that are not covered yet; at most ten cards per run.
6. Finish with a short Turkish summary for the user:
   - what was written,
   - the riskiest findings (for example a Supabase table with RLS off, or rules that allow broad writes),
   - the draft card IDs,
   - and that nothing was committed.
