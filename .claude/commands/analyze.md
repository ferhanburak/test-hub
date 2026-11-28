---
description: Analyse a project, write function-level tests with expected behaviour, run them, and produce the test report, SRS and SDD in its docs/analysis folder
argument-hint: <project folder, e.g. ../carfollow>
---

Analyse and test the project at `$ARGUMENTS`. Talk to the user in Turkish; write the documents and cards in Turkish, code and test names in English.

Folders: **PROJECT** is `$ARGUMENTS`. **HUB** is the test-hub folder this command lives in (the current folder when run locally). In GitHub Actions the prompt names both.

## Rules

- Never open, read or quote `.env` files, keys, tokens, service account files or other secrets. Write only the **names** of environment variables.
- Everything goes into PROJECT: tests next to its existing tests, cards in `tests/catalog/`, documents in `docs/analysis/`. Nothing about the project is written into HUB, which is a public repository.
- Do not change application code. When a test finds a bug, the test stays and the bug is documented (see step 6).
- Tests never send real email, SMS, push notifications or payments and never call production services. Mock network and third-party SDKs; use the local Firebase emulator or Supabase database only when the project already does.
- Do not commit or push. Locally the user reviews the changes; in GitHub Actions the workflow opens a pull request.

## Steps

1. **Static facts.** Run `node HUB/scripts/analyze.mjs --target PROJECT`. It writes `docs/analysis/facts.json` and `static.md` with packages, configs, Firestore collections, Supabase tables and RLS, routes, environment variable names and test counts.
2. **Context.** Read `facts.json`, the existing tests and `tests/catalog/` cards. From the cards take the project key (`project:`), the line (`line:`) and the ID prefix (for example `MLK-MOB`). If there are no cards yet, ask locally; in Actions use the values in the prompt. New IDs continue after the highest existing number. Find how tests run: the npm script that writes `test-results/test-hub-*.json` (Jest/Vitest JSON) or `test-hub-*.xml` (JUnit). If no such script exists, use the project's test command with a JSON or JUnit reporter and write to the same place.
3. **Function inventory** (`docs/analysis/functions.md`). List every exported function, API route handler, database rule set and store or hook with logic. Leave out pure layout components. For each one, write:
   - the file and function name,
   - what it does in one sentence,
   - the **expected behaviour**: the normal case, edge cases, invalid input and errors, and for data access who may and may not read or write,
   - the card IDs that cover it, or "test yok".

   Order the list by risk: authentication and authorization, data writes and security rules, payments and messaging, business logic, then helpers.
4. **Tests and cards.** For the riskiest functions without tests, write tests. Write at most 25 new cards per run; the next run continues from the inventory.
   - One card per function, or per group of closely related behaviours. Each card has its own ID.
   - Every test's name, or its `describe` block, starts with the card ID, for example `describe('MLK-MOB-013 pushProgress', ...)`.
   - Follow the project's test framework, file locations and style. Reuse existing mocks and fixtures.
   - Card file `tests/catalog/<ID>.md`:

     ```markdown
     ---
     id: <ID>
     title: <what it checks, in Turkish>
     project: <project key>
     line: <line>
     type: automated
     priority: critical | high | medium | low
     env: unit | ci-supabase | ci-firebase | e2e-device
     status: not-written
     function: <path/to/file.ts#functionName>
     requirement: <FR-xxx from the SRS>
     ---

     ## Amaç

     <why this matters, one or two sentences>

     ## Beklenen

     - <one expected behaviour per line, the same cases the test asserts>

     ## Adımlar

     1. <what the test does>
     ```
5. **Run.** Install dependencies if needed and run the tests so they write the result files. Then run:

   ```
   node HUB/scripts/report.mjs --project <key> --catalog PROJECT/tests/catalog --unit <each result file> --out PROJECT/docs/analysis/summary.md --doc PROJECT/docs/analysis/TEST-REPORT.md --write
   ```

   `--write` updates each card's `status`. The script exits with 1 when a critical test fails; that is expected, so continue.
6. **Failures.** For every failing new test, decide which side is wrong:
   - **The test is wrong** (wrong mock, wrong assumption about the API): fix the test and run again.
   - **The code is wrong** (the behaviour breaks what the function promises, a security rule lets the wrong user in, an error is swallowed): keep the test failing. Add `needs_fix: true` to the card and a `## Sorun` section with what goes wrong, where (file and line) and a suggested fix. Never weaken an assertion to hide a bug.

   Run step 5 again after the last change, so `TEST-REPORT.md` shows the final state. Its "Çözülmesi gerekenler" list is the to-do list for the project. After the pull request is merged, the regular test-hub workflow opens a GitHub Issue labelled `needs-fix` for each failing test.
7. **SRS** (`docs/analysis/SRS.md`), following ISO/IEC/IEEE 29148:
   1. Giriş: amaç, kapsam, tanımlar.
   2. Genel tanım: ürün, kullanıcı sınıfları, kısıtlar, varsayımlar.
   3. Fonksiyonel gereksinimler `FR-001`…: each with a description, an acceptance criterion, its source file and the card IDs that test it.
   4. Fonksiyonel olmayan gereksinimler `NFR-001`…: security, privacy, performance, accessibility, localisation.
   5. Dış arayüzler: UI, API, third-party services.
   6. İzlenebilirlik matrisi: a table of `FR` to card IDs and status, with untested requirements marked.

   Requirements describe what the code does today. Mark guesses with "(çıkarım)".
8. **SDD** (`docs/analysis/SDD.md`), following IEEE 1016:
   1. Giriş.
   2. Mimari: C4 context and container diagrams (Mermaid `flowchart`).
   3. Bileşenler: responsibility, interfaces and dependencies for each module, with a Mermaid `classDiagram`.
   4. Veri tasarımı: Mermaid `erDiagram` and security rules or RLS.
   5. Arayüz tasarımı: routes, API endpoints and their inputs and outputs.
   6. Dinamik görünüm: Mermaid `sequenceDiagram` for the two or three most important flows.
   7. Güvenlik tasarımı.
   8. Kararlar, riskler ve teknik borç.

   Give each diagram a one-line note on its source and reliability: **kesin**, **çıkarım** or **yorum**.
9. **Handover pack** (`docs/analysis/README.md`). Start with frontmatter `analyzed_commit: <git rev-parse HEAD>` and `analyzed_at: <YYYY-MM-DD>`. Then cover: genel bakış, lokalde çalıştırma (environment variable names only), kod haritası, deploy, and links to `functions.md`, `TEST-REPORT.md`, `SRS.md` and `SDD.md`. On a later run, if `analyzed_commit` exists, start from `git -C PROJECT diff --name-only <analyzed_commit> HEAD` and update only what changed.
10. Every document starts with the line `> Otomatik üretildi, kontrol edilmedi.`, except `TEST-REPORT.md`, which the script writes.
11. **Summary for the user, in Turkish:**
    - the new card IDs,
    - how many tests passed and failed,
    - the "Çözülmesi gerekenler" list,
    - the riskiest findings,
    - which documents were written,
    - and that nothing was committed (locally) or that a pull request follows (in Actions).
