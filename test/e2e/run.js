'use strict';
/*
 * End-to-end smoke test, fully local:
 *  - starts an HTTPS server on 127.0.0.1 that serves fixture.html,
 *  - starts headless Chromium with the unpacked extension loaded and
 *    www.youtube.com mapped to that server (no request leaves the machine),
 *  - dumps the DOM and checks which cards got the data-restrict attribute.
 *
 * Usage: node test/e2e/run.js   (needs chromium and openssl)
 */
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const CHROMIUM = process.env.CHROMIUM || 'chromium';
const fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'));
const fixtureShorts = fs.readFileSync(path.join(__dirname, 'fixture-shorts.html'));
const fixtureWatch = fs.readFileSync(path.join(__dirname, 'fixture-watch.html'));
const fixtureReport = fs.readFileSync(path.join(__dirname, 'fixture-report.html'));

// Chrome derives an unpacked extension's id from its absolute path.
const EXTENSION_ID = Array.from(crypto.createHash('sha256').update(ROOT).digest('hex').slice(0, 32), (c) =>
  String.fromCharCode(97 + parseInt(c, 16))
).join('');

function makeCert(dir) {
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=www.youtube.com'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

// Must be async: a synchronous spawn would block the HTTPS server above.
function runChromium(args) {
  return new Promise((resolve) => {
    const child = spawn(CHROMIUM, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ status: -1, stdout, stderr: String(e) });
    });
  });
}

function profileDir() {
  // Snap-packaged Chromium can only write inside its own area of $HOME.
  const snapCommon = path.join(os.homedir(), 'snap', 'chromium', 'common');
  const base = fs.existsSync(snapCommon) ? snapCommon : os.tmpdir();
  return fs.mkdtempSync(path.join(base, 'restrict-e2e-'));
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'restrict-cert-'));
  const reports = []; // what reached the stand-in for YouTube's feedback endpoint
  const server = https.createServer(makeCert(tmp), (req, res) => {
    if (process.env.E2E_DEBUG) console.error('request', req.url);
    if (req.url.startsWith('/youtubei/v1/feedback')) {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        let json = {};
        try {
          json = JSON.parse(body);
        } catch (e) {
          /* recorded as empty */
        }
        reports.push({ token: (json.feedbackTokens || [])[0], context: json.context, auth: req.headers.authorization || '', at: Date.now() });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }));
      });
      return;
    }
    if (req.url.startsWith('/oembed')) {
      // Stand-in for YouTube's oEmbed endpoint.
      const target = decodeURIComponent(req.url);
      const authors = {
        ccccccccc11: { author_name: 'The Casino King', author_url: 'https://www.youtube.com/@TheCasinoKing' },
        sssssssss01: { title: 'She accidentally bet $20 and won big #casino', author_name: 'Some Name', author_url: 'https://www.youtube.com/@somename' },
        sssssssss02: { title: 'Easy pasta in 30 seconds', author_name: 'Pasta Daily', author_url: 'https://www.youtube.com/@pastadaily' },
        sssssssss03: { title: 'A normal day', author_name: 'gamblingchronicles', author_url: 'https://www.youtube.com/@gamblingchronicles' },
        ccccccccc12: { author_name: 'Pasta Daily', author_url: 'https://www.youtube.com/@pastadaily' },
      };
      const id = Object.keys(authors).find((k) => target.includes(k));
      if (!id) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(Object.assign({ type: 'video', version: '1.0' }, authors[id])));
      return;
    }
    if (req.url.startsWith('/slow.png')) {
      // Holds back the load event (and with it --dump-dom) until the fixture's
      // timers and the extension's reactions to them have run.
      const ms = Number(new URL(req.url, 'https://x').searchParams.get('ms')) || 3000;
      setTimeout(() => {
        res.writeHead(204);
        res.end();
      }, ms);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    const u = req.url;
    res.end(u.startsWith('/watch') ? fixtureWatch : u.startsWith('/shorts/') ? fixtureShorts : u.startsWith('/report') ? fixtureReport : fixture);
  });
  if (process.env.E2E_DEBUG) {
    server.on('connection', () => console.error('tcp connection'));
    server.on('tlsClientError', (e) => console.error('tls error', e.message));
  }
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const profile = profileDir();

  const dump = (url) =>
    runChromium([
      '--headless=new',
      '--no-first-run',
      '--disable-gpu',
      '--user-data-dir=' + profile,
      '--disable-extensions-except=' + ROOT,
      '--load-extension=' + ROOT,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--host-resolver-rules=MAP www.youtube.com 127.0.0.1:' + port,
      '--ignore-certificate-errors',
      '--disable-quic',
      '--no-proxy-server',
      '--dump-dom',
      url,
    ]);

  // Replaces the extension's storage.local, through a test-only extension page.
  const seed = async (state) => {
    const out = await dump('chrome-extension://' + EXTENSION_ID + '/test/e2e/seed.html?state=' + encodeURIComponent(JSON.stringify(state)));
    return (out.stdout || '').includes('data-seeded="yes"');
  };
  // Runs one page and returns the reports YouTube received meanwhile.
  const reportsDuring = async (url) => {
    reports.length = 0;
    await dump(url);
    return reports.splice(0);
  };

  let dom = '';
  let watchGambling = '';
  let watchClean = '';
  let shortsCasino = '';
  let shortsClean = '';
  let shortsChannel = '';
  let reportsBefore = [];
  const seeded = [];
  let sentBlockedOnly = [];
  let sentAgain = [];
  let sentTellYoutube = [];
  let sentLoggedOut = [];
  try {
    const out = await dump('https://www.youtube.com/fixture');
    dom = out.stdout || '';
    if (process.env.E2E_DEBUG) console.error('status', out.status, 'stdout bytes', dom.length);
    if (!dom.includes('id="t1"')) {
      console.error('Chromium did not return the fixture DOM.\n' + (out.stderr || '').slice(-1500));
      process.exitCode = 2;
      return;
    }
    watchGambling = (await dump('https://www.youtube.com/watch?v=gggggggggg1&case=gambling')).stdout || '';
    watchClean = (await dump('https://www.youtube.com/watch?v=cccccccccc1&case=clean')).stdout || '';
    shortsCasino = (await dump('https://www.youtube.com/shorts/sssssssss01')).stdout || '';
    shortsClean = (await dump('https://www.youtube.com/shorts/sssssssss02')).stdout || '';
    shortsChannel = (await dump('https://www.youtube.com/shorts/sssssssss03')).stdout || '';
    reportsBefore = reports.splice(0);

    const lists = { userChannels: [{ handle: '@zoodiary', name: 'Zoo Diary' }], allowChannels: [{ handle: '@newsdesk' }] };
    seeded.push(await seed(lists));
    sentBlockedOnly = await reportsDuring('https://www.youtube.com/report');
    sentAgain = await reportsDuring('https://www.youtube.com/report'); // same storage: already reported
    const tell = Object.assign({ settings: { tellYoutube: true } }, lists);
    seeded.push(await seed(tell));
    sentTellYoutube = await reportsDuring('https://www.youtube.com/report');
    seeded.push(await seed(tell));
    sentLoggedOut = await reportsDuring('https://www.youtube.com/report?loggedOut=1');
  } finally {
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  let failed = 0;
  const tagRe = /<[^>]*\bdata-expect="(hidden|shown)"[^>]*>/g;
  let m;
  let seen = 0;
  while ((m = tagRe.exec(dom)) !== null) {
    seen++;
    const tag = m[0];
    const id = (tag.match(/\bid="([^"]+)"/) || [])[1];
    const marked = /\bdata-restrict="hidden"/.test(tag);
    const info = (tag.match(/data-restrict-info="([^"]*)"/) || [])[1] || '';
    const pending = /\bdata-restrict="pending"/.test(tag);
    const ok = !pending && marked === (m[1] === 'hidden');
    if (!ok) failed++;
    console.log((ok ? 'ok      ' : 'FAILED  ') + id.padEnd(4) + ' expected ' + m[1].padEnd(6) + (pending ? ' STUCK pending' : marked ? ' marked: ' + info : ' not marked'));
  }
  if (seen < 14) {
    console.log('FAILED  only ' + seen + ' of 14 cards found in the DOM');
    failed++;
  }

  const guardChecks = [
    ['watch page with a gambling title shows the guard', watchGambling.includes('class="restrict-guard"')],
    ['opened video cover carries no explanation text', !/looks like gambling|Hidden by Restrict/.test(watchGambling)],
    ['Short with #casino in its looked-up title is skipped', shortsCasino.includes('data-skipped="down"')],
    ['Short from @gamblingchronicles is skipped', shortsChannel.includes('data-skipped="down"')],
    ['harmless Short is left alone (owner of a hidden, earlier watch page ignored)', shortsClean.includes('id="shorts-player"') && !shortsClean.includes('data-skipped="') && !shortsClean.includes('restrict-guard')],
    ['watch page with a clean title has no guard', watchClean.includes('id="movie_player"') && !watchClean.includes('restrict-guard')],
  ];
  const tokens = (list) => list.map((r) => r.token).sort();
  const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const gaps = sentTellYoutube.slice(1).map((r, i) => r.at - sentTellYoutube[i].at);
  const authOk = (r) => {
    const m = /^SAPISIDHASH (\d+)_([0-9a-f]{40})_u$/.exec(r.auth);
    if (!m) return false;
    const want = crypto.createHash('sha1').update('e2e-user ' + m[1] + ' e2e-sid https://www.youtube.com').digest('hex');
    return m[2] === want;
  };
  const show = (list) => ' [' + tokens(list).join(', ') + ']';
  guardChecks.push(
    ['pages without YouTube config report nothing', reportsBefore.length === 0],
    ['test state was written to storage', seeded.length === 3 && seeded.every(Boolean)],
    ['switch off: only the channel the user blocked is reported' + show(sentBlockedOnly), sameList(tokens(sentBlockedOnly), ['CH-r1'])],
    ['a reported channel is not reported again on the next visit' + show(sentAgain), sentAgain.length === 0],
    [
      'switch on: blocked channel, keyword video, channel-name channel once; never-hide, harmless and recycled cards not' + show(sentTellYoutube),
      sameList(tokens(sentTellYoutube), ['CH-r1', 'CH-r3', 'NI-r2']),
    ],
    ['reports are at least 3 s apart (' + gaps.join(', ') + ' ms)', gaps.length === 2 && gaps.every((g) => g >= 2900)],
    ['reports carry the signed-in session header and context', sentTellYoutube.length > 0 && sentTellYoutube.every((r) => authOk(r) && r.context && r.context.client)],
    ['signed out: nothing is reported' + show(sentLoggedOut), sentLoggedOut.length === 0]
  );
  for (const [name, ok] of guardChecks) {
    if (!ok) failed++;
    console.log((ok ? 'ok      ' : 'FAILED  ') + name);
  }
  console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
