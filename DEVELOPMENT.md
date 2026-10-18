# Development

How Hide Gambling Content works inside, and how to test, build and release
it. The user guide is [README.md](README.md).

## Running it from source

### Chrome / Chromium / Edge / Brave (111 or newer)

1. Open `chrome://extensions`, switch on **Developer mode**.
2. **Load unpacked** and pick this folder.

Chrome prints a warning about the unknown key `browser_specific_settings`.
That key is for Firefox and the warning is harmless. The packaged Chrome zip
leaves it out.

### Firefox (128 or newer)

- For development: `about:debugging` → **This Firefox** → **Load Temporary
  Add-on** → pick `manifest.json`. It stays until Firefox restarts.
- For permanent use Firefox requires a signed add-on: run `npm run package`,
  upload the `-firefox.zip` to addons.mozilla.org as an *unlisted* add-on and
  install the signed `.xpi` you get back. Firefox Developer Edition and ESR
  can instead turn off `xpinstall.signatures.required`.

Reload open YouTube tabs after loading or reloading the extension.

## Commands

No build step and no dependencies.

```
npm test               # unit tests (matcher, normalisation, store, report codes, data files)
npm run e2e            # loads the real extension into headless Chromium
npm run lint:firefox   # web-ext lint
npm run package        # dist/hide-gambling-content-<version>-{chrome,firefox}.zip
```

The end-to-end test is fully local: it serves `test/e2e/*.html` from
127.0.0.1 and maps `www.youtube.com` to it inside the test browser, including
stand-ins for YouTube's oEmbed and feedback endpoints. Stored settings for a
test case are written through `test/e2e/seed.html`, an extension page that is
not packaged.

`npm run package` runs the unit tests first. The two zips differ only in the
manifest: the Chrome one drops `browser_specific_settings`. Chrome Web Store
listing text and images are in `store/`.

## Layout

```
manifest.json
src/normalize.js, matcher.js    pure logic, also runs under Node
src/selectors.js                every YouTube selector
src/extract.js                  DOM -> { videoId, title, channel… }
src/store.js                    storage.local, bundled JSON, feedback loop, Shorts lookup cache
src/content.js, content.css     observer, marking, watch-page guard, report queue
src/page.js                     runs in YouTube's page: sends reports to YouTube
src/popup/, src/options/        UI
data/                           keyword and channel lists
store/                          Chrome Web Store listing text and images (not packaged)
PRIVACY.md                      privacy policy linked from the store listing
```

There is no background script. Popup, options page and content scripts
share state through `storage.local` and react to `storage.onChanged`.

## How matching works

Text is normalised first: lowercase, accents removed, look-alike Unicode
letters folded (`𝐂𝐀𝐒𝐈𝐍𝐎` becomes `casino`), invisible characters removed.
Words are matched on Unicode-aware word boundaries, so `bets` does not match
`alphabets`.

Order of evaluation for each card:

1. channel on the **never hide** list → shown,
2. channel on a **blocklist**, or channel name containing a **channel-name
   term** → hidden,
3. **exceptions** are cut out of the text ("Casino Royale", "PCIe slot",
   "ключевая ставка"),
4. score = 2 × distinct strong hits + 1 × distinct weak hits, over the title,
   the channel name and the description when the page shows one. Hidden when
   the score reaches the threshold (default 2).

### Keyword files

`data/keywords/<lang>.json` and `data/brands.json`, each with `strong`,
`weak` and `exceptions` arrays, in the same entry syntax as Settings (see the
README). To add a language, add the file and one line to `LANGUAGES` in
`src/store.js`.

### Channel list

`data/channels.json`:

```json
{ "id": "UCDyrCJyFaOLc8OnnCd0Khcg", "handle": "", "name": "Brian Christopher Slots" }
```

A channel is matched by `id`, or by a compact key built from both handle and
name: `MrHandPay`, `@mrhandpay` and `Mr. Hand Pay` are the same channel. So an
entry with only a name is enough, which matters because YouTube cards rarely
show the id. The directory-sourced entries carry ids and names; entries tagged
`user-reported` carry the name only.

### Channel-name terms

The `channel` array in `data/brands.json` (and "Channel name contains" in
Settings) blocks every channel whose name or handle contains a term, also
inside glued words: `jackpot` blocks "JackpotJudo" and `@jackpotjudo`.
Built in: casino (all spellings), jackpot, gambling/gambler/gambles, slots,
bonus hunt, high roller and sports betting. The never-hide list wins over it.

## Reporting to YouTube

What is reported and when is described in the README. How it works:
`src/page.js` runs inside YouTube's own page (`"world": "MAIN"`), because
only there is the data YouTube attaches to its cards visible. It takes the
code of the right ⋮ menu entry from a home-feed card's data
(`ytd-rich-item-renderer.data`), only if that entry names exactly the
expected video, and posts it to `/youtubei/v1/feedback`. The content script
decides what to report and keeps the queue. When YouTube changes its data,
`ACTION_ICONS` and `cardData()` in `src/page.js` are the places to fix.

## When something is not hidden

YouTube changes its markup often.

- a video that should be hidden is shown → open Settings and paste the title
  into **Try a title**. If it scores, the card's markup is not recognised: fix
  `src/selectors.js`. If it does not score, add a keyword.
- a harmless video is hidden → find out why: in the browser's developer tools
  search the Elements panel for `data-restrict-info`; every hidden card carries
  the rule that fired. Then add an exception phrase, or put the channel on the
  never-hide list.
