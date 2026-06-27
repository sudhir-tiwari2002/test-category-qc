# test-category-qc

Automated QC / sanity for a **PhysicsWallah admin test category in preview
mode**. Attaches to Sakshi's already-open Chrome, auto-scrolls through every
question card on the preview page, and for **both English and Hindi** verifies:

| # | Check | What it asserts |
| - | --- | --- |
| 1 | `correct_answer_marked` | Each card has a marked-correct option |
| 2 | `correct_option_named` | The answer section names the correct option (e.g. "Option B", "(B)", "उत्तर 2", `\u0915\u093e\u0902चित अंक`) |
| 3 | `correct_option_explained` | The correct option's content (text / image) actually appears in the answer section |
| 4 | `missing_field` | No empty question / option / solution |
| 5 | `image_loaded` | Every image in the card loaded (no broken `<img>`) |
| 6 | `image_cutoff` | Nothing in the card is clipped or overflowing its container |
| 7 | `hindi_present` | On the Hindi pass: Devanagari text present, options translated, not just a copy of English |

Output: an **Excel summary** (one row per question per language) plus an **HTML
report** with screenshots of every failing card and the OCR'd solution text
beside each verdict.

---

## TL;DR — anyone, any device, any Chrome profile

```bash
git clone https://github.com/sudhir-tiwari2002/test-category-qc.git
cd test-category-qc
./install.sh                # installs Node deps, copies .env, optionally adds `qc` to PATH

qc all                      # picker → Chrome opens → you open the category → QC runs → report
```

That's it. The single `qc` command knows everything; run `qc help` to see it
all. The first time you run it, you'll be asked which of your Chrome profiles
to QC with (or you can pass `--profile "Sudhir"` to skip the picker).

### The `qc` CLI

| Command | What it does |
| --- | --- |
| `qc setup` | One-time install of Node deps + `.env` (same as `./install.sh`) |
| `qc doctor` | Sanity-check Node, Chrome, debug port, active tab |
| `qc profiles` | List all Chrome profiles on this machine (display name + on-disk dir) |
| `qc launch-chrome` | Open Chrome with debug port; interactive profile picker by default |
| `qc launch-chrome --profile "name"` | Skip the picker, use that profile (display name or dir name) |
| `qc launch-chrome --fresh` | Empty profile — you'll sign into PW admin once, then it persists |
| `qc launch-chrome --reset` | Delete the QC profile copy and re-copy from your real Chrome |
| `qc run [flags]` | Attach to Chrome and QC the active preview tab |
| `qc report` | Open the most recent HTML report |
| `qc all [--profile X]` | `launch-chrome` → wait → `run` → `report` (one-shot) |
| `qc inspect` | Dump live DOM hints (selector-calibration helper) |
| `qc install-global` | Symlink `bin/qc` into `/usr/local/bin/qc` |
| `qc help` | Show all of the above |

Any of `qc run`'s flags map 1:1 onto the underlying CLI flags (see § 4 below).

### Profile picker — what's actually happening

Chrome 136+ refuses to expose `--remote-debugging-port` against your real
user-data-dir for security reasons. So the script keeps a separate
`~/chrome-qc-profile` directory which is a copy of your real Chrome data.
The picker just lets you choose *which* of your profiles inside that copy
Chrome should open (`--profile-directory=...`).

- **First launch:** copies your real Chrome user-data-dir into
  `~/chrome-qc-profile` (a few GB if you have many profiles — one-time cost).
  All your logins/cookies/bookmarks/saved passwords come along.
- **Switching profiles:** instant — `qc launch-chrome --profile "Other"` just
  re-launches Chrome with a different `--profile-directory`. No re-copy.
- **Adding a new profile to the picker later:** Chrome's profile metadata is
  cached, so if you create a new profile in your real Chrome and want it in
  the picker, run `qc launch-chrome --reset` once to re-copy.

---

## 1. Install (manual path, if you don't want `./install.sh`)

```bash
npm install
npx playwright install chromium      # only needed if you ever want Playwright to spawn its own browser
```

## 2. Launch Chrome so the script can attach

> **Important — Chrome 136+ behavior:** As of March 2025, Chrome
> [silently ignores `--remote-debugging-port`](https://developer.chrome.com/blog/remote-debugging-port)
> when used with your **default** user profile (it's an anti-cookie-theft
> measure). The debug port simply doesn't open and there's no error. The fix
> is to launch Chrome with a **separate `--user-data-dir`**. The script below
> takes care of all that.

### Easy way (recommended)

```bash
qc launch-chrome                              # interactive profile picker
qc launch-chrome --profile "Sudhir"           # skip the picker
qc launch-chrome --profile sakshi --reset     # re-copy + use the "sakshi" profile dir
qc launch-chrome --fresh                      # empty profile — sign in once
```

What it does:
1. Quits any running Chrome.
2. **First run only:** copies your real Chrome user-data-dir into
   `~/chrome-qc-profile` (all your profiles + their cookies, bookmarks,
   logins).
3. Launches Chrome on port **9333** with
   `--user-data-dir=~/chrome-qc-profile --profile-directory="<chosen>"`.
4. Waits until the debug port actually responds.
5. Prints the live Chrome version info.

Env overrides (also exposed as `qc launch-chrome` flags):

| Variable | Flag | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | _(none — set in `.env`)_ | `9333` | Debug port |
| `QC_PROFILE` | _(none)_ | `~/chrome-qc-profile` | Where the QC profile copy lives |
| `PROFILE_DIR` | `--profile <name>` | `Default` | Which profile (display name or on-disk dir) |
| `FRESH=1` | `--fresh` | _off_ | Skip the copy — empty profile (sign in once) |
| `RESET=1` | `--reset` | _off_ | Delete the QC profile copy and re-copy |

### Why port 9333 (not 9222)?

`adb` claims `127.0.0.1:9222` by default on machines with Android tooling.
If 9222 is busy, Chrome silently drops the flag (different reason but same
silent failure). 9333 sidesteps both pitfalls.

After Chrome opens, open the test category in **preview mode** in that browser
tab. Leave that tab focused.

## 3. Calibrate selectors (one-time, ~10 min)

Edit [`config/selectors.ts`](./config/selectors.ts). Because v2 runs entirely in
preview mode, you only need to fill out these:

| Key | What it should match |
| --- | --- |
| `preview.questionCard` | One element per question card on the preview page |
| `preview.questionCardId` | A stable id inside the card (data-question-id, data-id, visible "Q#") |
| `preview.questionBody` | The question text container inside one card |
| `preview.optionItem` | Each option row inside one card |
| `preview.optionText` | The text node inside one option |
| `preview.optionLabel` | The A/B/C/D label inside one option (omit if labels live inside `optionText`) |
| `preview.correctOptionMarker` | Selector / class that is present **only** on the correct option (e.g. `.correct`, `[data-correct="true"]`) |
| `preview.solutionToggle` | Click target that reveals the solution (only if collapsed) |
| `preview.solutionBody` | The solution / answer section inside one card |
| `page.scrollContainer` | `null` to scroll the window, OR a selector for the internal scrollable div |
| `page.languageSwitcher` / `page.languageOption` | Hindi/English toggle on the preview page |

**Calibration tip:** in DevTools console run
`document.querySelectorAll('YOUR_SELECTOR').length` and tweak until it matches
the expected count.

The script runs a **smoke check** on the most critical selectors first — if
something doesn't match you'll get a clear "selector not found" error rather
than silent garbage.

## 4. Run

```bash
# Smoke test with 1 question per language first:
qc run --max-questions 1

# Full run, default settings (en+hi, port 9333, ./reports):
qc run

# Custom:
qc run --languages hi,en --max-questions 10 --slow-mo-ms 100

# Skip OCR for speed (image-only solutions become WARN instead of FAIL):
qc run --no-ocr
```

`npm run qc -- <flags>` is equivalent to `qc run <flags>` — use whichever you
prefer.

CLI flags:

| Flag | Default | Description |
| --- | --- | --- |
| `--cdp-port <n>` | `9333` | Chrome remote-debugging port |
| `--category-url <url>` | _(active tab)_ | Tab URL to attach to (substring match) |
| `--languages <list>` | `en,hi` | Languages to QC |
| `--output-dir <dir>` | `./reports` | Where reports + screenshots are written |
| `--max-questions <n>` | `0` | Cap per language (`0` = all) |
| `--slow-mo-ms <n>` | `0` | Slow every Playwright action (useful on a laggy admin UI) |
| `--skip-smoke` | _off_ | Skip the selector smoke check (only after calibration is stable) |

Most settings can also live in `.env` (see `.env.example`).

## 5. Read the report

Each run produces in `./reports/`:

- `qc-report-YYYYMMDD-HHMM.xlsx` — **Summary** sheet (one row per
  question/language) + **Details** sheet (one row per check). Failures red.
- `qc-report-YYYYMMDD-HHMM.html` — Tiles + a card for every failing question
  with the failing checks and a screenshot of the preview as captured.
- `reports/shots/<question-id>-<lang>.png` — Per-card screenshots embedded in
  the HTML report.

## 6. How the auto-scroll works

`processAllQuestionCards` handles three layouts transparently:

- **All rendered up-front** — enumerated in one pass.
- **Lazy / infinite scroll** — we scroll a viewport-height step at a time and
  watch `scrollHeight`. New cards are processed as they appear.
- **Virtualized lists** — we re-query the DOM after every scroll step so
  recycled cards don't fool us. Dedup is by a stable id (or by 1-based order
  if no id is configured).

Enumeration stops after the scroll position + scroll height stop changing for
three consecutive iterations.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Could not connect to Chrome on port 9333 ... ECONNREFUSED` | Chrome isn't listening. Most common in 2025+: you launched Chrome on its **default** profile, which silently drops `--remote-debugging-port` (Chrome 136+ security change). Use `npm run launch-chrome` — it uses a separate `--user-data-dir` to bypass the restriction. |
| `curl: (52) Empty reply from server` on the debug port | Another process (commonly `adb`) is squatting on the port. Run `lsof -nP -iTCP:9333 -sTCP:LISTEN` to find the owner. Either kill it (`adb forward --remove tcp:9333` / `adb kill-server`) or pick a different port (`PORT=9444 npm run launch-chrome` and `npm run qc -- --cdp-port 9444`). |
| `curl http://127.0.0.1:9333/json/version` returns nothing | `-s` flag silently swallows connection errors. Drop the `-s` to see the real error. |
| Chrome process has the flag but port still closed | Confirm with `cat ~/chrome-qc-profile/DevToolsActivePort` — Chrome writes the actual port + websocket id here when the debug server is up. Empty / missing file ⇒ debug server didn't start. Run `npm run launch-chrome RESET=1` to rebuild the profile cleanly. |
| `No question cards found with selector ...` | `preview.questionCard` doesn't match. Open the preview in Chrome, inspect a card, update the selector. |
| Script processes only 1 card | `preview.questionCard` matches a wrapper instead of individual cards. Tighten the selector. |
| `correct_answer_marked` fails on every card | `preview.correctOptionMarker` is wrong. Inspect a known-correct option in DevTools and copy a class/attribute that is present **only** on it. |
| `correct_option_explained` fails on cards with image options | Expected when the option is image-only and the answer section also relies on images — check the screenshot in the HTML report. The check downgrades to a warn-like fail rather than crashing. |
| `hindi_present` fails on perfectly translated questions | The language switcher selector is wrong, so the page never actually switched. Manually click the switcher and re-inspect. |
| Lots of false-positive `image_cutoff` findings | The admin preview canvas is wider than student-mobile and may legitimately scroll. If those clips are expected, narrow `preview.questionCard` to scope just the question, not the surrounding chrome. |

## 8. Project layout

```
test-category-qc/
├── bin/
│   └── qc                    ← the executable wrapper (bash, no compile)
├── install.sh                ← one-shot installer for a fresh device
├── scripts/
│   └── launch-chrome.sh      ← cross-platform Chrome launcher with QC profile
├── config/
│   └── selectors.ts          ← calibrate selectors here (ONLY file you edit before first run)
├── src/
│   ├── index.ts              ← CLI entrypoint (invoked by `qc run`)
│   ├── browser.ts            ← attach to Chrome via CDP
│   ├── navigate.ts           ← switchLanguage + auto-scroll enumeration of cards
│   ├── runner.ts             ← per-language QC orchestration + selector smoke check
│   ├── types.ts
│   ├── extract/
│   │   └── previewExtractor.ts  ← DOM + OCR extraction
│   ├── checks/
│   │   └── index.ts          ← all 7 QC checks
│   ├── report/
│   │   ├── excelReporter.ts
│   │   └── htmlReporter.ts
│   └── utils/
│       ├── compare.ts        ← text normalization + list diff
│       ├── overflow.ts       ← in-page overflow / broken-image detection
│       ├── ocr.ts            ← Tesseract.js (eng+hin) for image solutions
│       └── logger.ts
├── .env.example
├── package.json              ← `bin: { qc: ./bin/qc }` → npm link makes `qc` global
├── tsconfig.json
└── README.md
```

## 9. Take this to another device

```bash
git clone https://github.com/sudhir-tiwari2002/test-category-qc.git
cd test-category-qc
./install.sh
qc all
```

The installer covers Node deps, `.env` bootstrap, and (optionally) globally
installs `qc`. The first `qc launch-chrome` clones your existing Chrome
user-data-dir into `~/chrome-qc-profile` so logins for ALL your profiles
carry over — no re-signing into PW admin required.

After that you only ever need:

```bash
qc all                              # interactive profile picker each run
qc all --profile "Sudhir"           # remember a default — same profile every run
```

or split into `qc launch-chrome` → `qc run` → `qc report` if you want manual
control between steps.

