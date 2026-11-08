// Cinecode Studio server: idea → questions → cinecode production (claude -p) → video → HyperFrames edits.
// Listens on localhost only. Runs on macOS, Windows and Linux. Each production runs in its own process
// group, so closing the window does not stop a film.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile, execFileSync } from 'node:child_process';

const PORT = +(process.env.CINECODE_STUDIO_PORT || 4910);
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const HOME = os.homedir();
const DIR = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)).replace(/^\/([A-Za-z]:)/, '$1');
const DATA = path.join(DIR, 'data');
const LOGS = path.join(DATA, 'logs');
const UPLOADS = path.join(DATA, 'uploads');
const JOBS_FILE = path.join(DATA, 'jobs.json');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const KIT = process.env.CINECODE_KIT || path.join(HOME, '.claude', 'skills', 'cinecode');
const HF_DIR = path.join(HOME, '.claude', 'plugins', 'cache', 'hyperframes');
const DESKTOP = fs.existsSync(path.join(HOME, 'Desktop')) ? path.join(HOME, 'Desktop') : HOME;
for (const d of [DATA, LOGS, UPLOADS]) fs.mkdirSync(d, { recursive: true });

// ---------- persistent state ----------
const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const settings = { filmsRoot: path.join(DESKTOP, 'Cinecode Films'), ...readJSON(SETTINGS_FILE, {}) };
let jobs = readJSON(JOBS_FILE, []);
// Bundled example project (read-only): shows a first-time user what a finished run looks like.
const EXAMPLE_DIR = path.join(DIR, 'example');
const example = (() => { const j = readJSON(path.join(EXAMPLE_DIR, 'job.json'), null); if (j) j.filmDir = path.join(EXAMPLE_DIR, 'film'); return j; })();
const allJobs = () => example && !settings.hideExample ? [example, ...jobs] : jobs;
for (const j of jobs) if (j.status === 'running') { j.status = 'stopped'; j.note = 'Uygulama kapandığında durdu.'; }
setTimeout(() => { for (const j of jobs) if (j.status !== 'running') syncResult(j); saveJobs(); }, 500);
const saveJobs = () => fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
saveJobs();
fs.mkdirSync(settings.filmsRoot, { recursive: true });

const procs = new Map();   // jobId → child
const clients = new Map(); // jobId → Set(res)

// ---------- platform ----------
const env = () => {
  const extra = [];
  if (WIN) {
    const ad = process.env.APPDATA, la = process.env.LOCALAPPDATA;
    extra.push(path.join(HOME, '.local', 'bin'), ad && path.join(ad, 'npm'), la && path.join(la, 'Programs', 'claude'));
  } else {
    let nvm = '';
    try { const v = fs.readdirSync(path.join(HOME, '.nvm/versions/node')).sort().pop(); if (v) nvm = path.join(HOME, '.nvm/versions/node', v, 'bin'); } catch {}
    extra.push(path.join(HOME, '.local/bin'), path.join(HOME, '.claude/local'), nvm, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin');
  }
  return { ...process.env, CINECODE_NO_OPEN: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
    PATH: [...extra.filter(Boolean), process.env.PATH || process.env.Path].filter(Boolean).join(path.delimiter) };
};
// Windows: claude may be claude.exe (native installer) or claude.cmd (npm). A .cmd needs cmd.exe.
let CLAUDE = null;
function claudeCmd() {
  if (CLAUDE) return CLAUDE;
  if (!WIN) return (CLAUDE = { cmd: 'claude', pre: [], shell: false });
  try {
    const hits = execFileSync('where', ['claude'], { env: env(), encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    const exe = hits.find(h => /\.exe$/i.test(h));
    if (exe) return (CLAUDE = { cmd: exe, pre: [], shell: false });
    const cmd = hits.find(h => /\.cmd$/i.test(h));
    if (cmd) return (CLAUDE = { cmd: process.env.ComSpec || 'cmd.exe', pre: ['/d', '/s', '/c', cmd], shell: false, quote: true });
  } catch {}
  return (CLAUDE = { cmd: 'claude', pre: [], shell: false });
}
const winQuote = s => /^[\w\-./:\\=@]+$/.test(s) ? s : '"' + String(s).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
function spawnClaude(args, opts) {
  const c = claudeCmd();
  const all = c.quote ? [...c.pre, ...args.map(winQuote)] : [...c.pre, ...args];
  return spawn(c.cmd, all, { env: env(), windowsHide: true, windowsVerbatimArguments: !!c.quote, ...opts });
}
const PY = WIN ? ['py', '-3'] : ['python3'];
const run = (cmd, args, opts = {}) => new Promise(ok => execFile(cmd, args, { env: env(), timeout: 20000, windowsHide: true, ...opts },
  (e, out, err) => ok({ code: e ? (e.code ?? 1) : 0, out: String(out || ''), err: String(err || '') })));
const py = (args, opts) => run(PY[0], [...PY.slice(1), ...args], opts);
const ps = script => run('powershell', ['-NoProfile', '-STA', '-Command', script], { timeout: 600000 });

function notify(title, text) {
  if (MAC) return run('osascript', ['-e', `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)} sound name "Glass"`]);
  if (WIN) return ps(`Add-Type -AssemblyName System.Windows.Forms; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; $n.ShowBalloonTip(6000,${JSON.stringify(title)},${JSON.stringify(text)},'Info'); Start-Sleep 7; $n.Dispose()`);
  return run('notify-send', [title, text]);
}
function reveal(p) {
  if (MAC) return run('open', fs.statSync(p).isDirectory() ? [p] : ['-R', p]);
  if (WIN) return run('explorer', fs.statSync(p).isDirectory() ? [p] : ['/select,', p]);
  return run('xdg-open', [fs.statSync(p).isDirectory() ? p : path.dirname(p)]);
}
// Native multi picker for images and videos; returns absolute paths.
async function pickMedia() {
  if (MAC) {
    const r = await run('osascript', ['-e', 'set fs to choose file of type {"public.image", "public.movie"} with multiple selections allowed', '-e', 'set out to ""', '-e', 'repeat with f in fs', '-e', 'set out to out & POSIX path of f & linefeed', '-e', 'end repeat', '-e', 'return out'], { timeout: 600000 });
    return r.code === 0 ? r.out.split('\n').map(x => x.trim()).filter(Boolean) : [];
  }
  if (WIN) {
    const r = await ps(`Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect=$true; $d.Filter='Görsel ve video|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.heic;*.mp4;*.mov;*.webm;*.m4v'; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write(($d.FileNames -join "\n"))}`);
    return r.out.split('\n').map(x => x.trim()).filter(Boolean);
  }
  const r = await run('zenity', ['--file-selection', '--multiple', '--separator=\n'], { timeout: 600000 });
  return r.code === 0 ? r.out.split('\n').map(x => x.trim()).filter(Boolean) : [];
}
// Native picker; returns an absolute path or null.
async function pick(kind) {
  if (MAC) {
    const of = { video: ' of type {"public.movie"}', audio: ' of type {"public.audio"}', image: ' of type {"public.image"}', text: ' of type {"public.text"}' }[kind] || '';
    const r = await run('osascript', ['-e', kind === 'folder' ? 'POSIX path of (choose folder with prompt "Referans klasörü")' : `POSIX path of (choose file${of})`], { timeout: 600000 });
    return r.code === 0 ? r.out.trim().replace(/\/$/, '') : null;
  }
  if (WIN) {
    const filter = { video: 'Video|*.mp4;*.mov;*.webm;*.mkv', audio: 'Ses|*.mp3;*.wav;*.m4a;*.flac;*.ogg', image: 'Görsel|*.png;*.jpg;*.jpeg;*.svg;*.webp', text: 'Metin|*.txt;*.md;*.srt;*.fountain' }[kind] || 'Tümü|*.*';
    const r = kind === 'folder'
      ? await ps(`Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.SelectedPath)}`)
      : await ps(`Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='${filter}'; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.FileName)}`);
    return r.out.trim() || null;
  }
  const r = await run('zenity', ['--file-selection', ...(kind === 'folder' ? ['--directory'] : [])], { timeout: 600000 });
  return r.code === 0 ? r.out.trim() : null;
}
function killTree(child) {
  if (WIN) return run('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
}

// ---------- helpers ----------
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req, limit = 2e6) => new Promise((ok, no) => {
  const chunks = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > limit) { no(new Error('too big')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => ok(Buffer.concat(chunks)));
  req.on('error', no);
});
const inside = (p, root) => { const r = path.resolve(p), b = path.resolve(root); return r === b || r.startsWith(b + path.sep); };
const VIDEO_RE = /\.(mp4|mov|webm|m4v|mkv)$/i, MEDIA_RE = /\.(png|jpe?g|webp|gif|heic|svg|mp4|mov|webm|m4v)$/i;
const picked = new Set(); // files the user chose in the native picker this session (previewable before a job exists)
const allowedFile = p => picked.has(p) || [settings.filmsRoot, UPLOADS, KIT, EXAMPLE_DIR, ...jobs.flatMap(j => [j.refFolder, j.refVideo, j.musicFile, ...(j.refImages || []), ...(j.appVideos || [])].filter(Boolean))].some(r => inside(p, r));

// ---------- sizes ----------
const SIZES = {
  '16:9': { 720: [1280, 720], 1080: [1920, 1080], 2160: [3840, 2160] },
  '9:16': { 720: [720, 1280], 1080: [1080, 1920], 2160: [2160, 3840] },
  '1:1': { 720: [720, 720], 1080: [1080, 1080], 2160: [2160, 2160] },
  '4:5': { 720: [864, 1080], 1080: [1080, 1350], 2160: [2160, 2700] },
};
const sizeOf = s => (SIZES[s.aspect] || SIZES['16:9'])[s.res] || [1920, 1080];
const fmtDur = sec => sec < 60 ? `${sec} saniye` : (sec % 60 ? `${Math.floor(sec / 60)} dakika ${sec % 60} saniye` : `${sec / 60} dakika`);

// Production time estimate (minutes): learns from finished films, otherwise a rough start value.
function estimate(mode, seconds) {
  const done = jobs.filter(j => j.mode === mode && j.workMs && j.seconds && j.lastVideo);
  if (done.length) {
    const perSec = done.reduce((a, j) => a + j.workMs / 60000 / j.seconds, 0) / done.length;
    return { minutes: Math.max(5, Math.round(perSec * seconds)), basis: `${done.length} filmden öğrenildi` };
  }
  return { minutes: Math.round(mode === 'film' ? 45 + seconds * 0.6 : 12 + seconds * 0.3), basis: 'ilk tahmin' };
}

// ---------- status ----------
async function status() {
  const k = await py([path.join(KIT, 'scripts', 'keys.py'), 'list'], { cwd: HOME });
  const keys = {};
  for (const line of k.out.split('\n')) { const m = line.match(/^(\w+)\s+(set|not set)/); if (m) keys[m[1]] = m[2] === 'set'; }
  const chromePaths = MAC ? ['/Applications/Google Chrome.app'] : WIN
    ? [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean).map(p => path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const c = claudeCmd();
  const [node, ff, pyv, cl] = await Promise.all([run('node', ['-v']), run('ffmpeg', ['-version']), py(['-V']), run(c.cmd, [...c.pre, '--version'])]);
  return {
    keys, filmsRoot: settings.filmsRoot, hideExample: !!settings.hideExample, hasExample: !!example, platform: process.platform, claude: cl.code === 0 ? cl.out.trim().split(/\s/)[0] : null,
    kit: fs.existsSync(path.join(KIT, 'SKILL.md')), hyperframes: fs.existsSync(HF_DIR),
    tools: { node: node.code === 0, ffmpeg: ff.code === 0, python: pyv.code === 0, chrome: chromePaths.some(p => fs.existsSync(p)) },
  };
}

// ---------- questions ----------
const Q_SCHEMA = { type: 'object', required: ['title', 'questions'], properties: {
  title: { type: 'string' },
  questions: { type: 'array', items: { type: 'object', required: ['id', 'q', 'options'], properties: {
    id: { type: 'string' }, q: { type: 'string' }, multi: { type: 'boolean' },
    options: { type: 'array', items: { type: 'object', required: ['label'], properties: { label: { type: 'string' }, hint: { type: 'string' } } } },
  } } },
} };

const talk = s => { const on = s.voice && s.voice !== 'none'; return { narr: on && (s.narr ?? !s.dialog), dlg: on && !!s.dialog }; };
function describeSettings(s) {
  const [w, h] = sizeOf(s);
  return [
    `Mod: ${s.mode === 'film' ? 'Film' : 'Hızlı'}`,
    `Amaç: ${s.purpose === 'ad' ? 'Reklam & ürün' : s.purpose === 'app' ? 'Uygulama tanıtım videosu (promo)' : 'Sinematik'}`,
    ...(s.purpose === 'app' ? [
      `Uygulama: ${s.appName || '(adı verilmedi)'}${s.appWhat ? `; ne yapar: ${s.appWhat}` : ''}${s.appCta ? `; kapanış çağrısı: ${s.appCta}` : ''}`,
      'Promo kuralı: uygulamanın gerçek ekranları (kullanıcının verdiği ekran görüntüleri ya da ekran kaydı) telefon çerçevesinde kahraman olur; ekranlardaki arayüzü uydurma, yoksa soyut ve stilize göster. Kanca ilk 2 saniyede, sonda logo/ad ve çağrı.',
    ] : []),
    `Süre: yaklaşık ${fmtDur(s.seconds)}`,
    `Biçim: ${s.aspect}, ${w}x${h}, ${s.fps} fps`,
    `Dil (anlatım ve ekrandaki yazılar): ${s.lang === 'en' ? 'İngilizce' : 'Türkçe'}`,
    `${talk(s).dlg ? 'Seslendirme motoru' : 'Anlatım sesi'}: ${({ none: 'yok, anlatımsız', gemini: 'Gemini TTS', elevenlabs: 'ElevenLabs', ema: 'EMA Lightning (yerel, internetsiz)' })[s.voice] || 'yok'}` +
      (talk(s).narr ? `; anlatıcının sesi: ${s.voiceGender === 'male' ? 'erkek' : s.voiceGender === 'female' ? 'kadın' : 'sen seç'}; ton: ${s.voiceTone || 'filme göre sen seç'}${s.voice === 'elevenlabs' && s.voiceId ? `; ElevenLabs ses kimliği: ${s.voiceId}` : ''}` : ''),
    `Konuşma: ${talk(s).narr && talk(s).dlg ? 'anlatıcı VE diyalog birlikte' : talk(s).narr ? 'yalnız anlatıcı, karakterler konuşmaz' : talk(s).dlg ? 'yalnız diyalog, anlatıcı yok' : 'yok'}`,
    ...(talk(s).dlg ? [`Diyalog: karakterleri ve seslerini senaryoya göre sen belirle (en fazla 4). Her repliği ayrı bir WAV olarak o karakterin kendi sesiyle üret (tts.py --text --id --voice; karakter başına farklı, filme uyan bir ses, aynı karakter hep aynı ses; çocuk için genç ve hafif bir ses).${talk(s).narr ? ' Anlatıcı karakterlerden açıkça ayrı bir ses; anlatım ve replikler üst üste binmez.' : ''} Sesleri sound.md §4b gibi kulakla seçtir: her karakter için 2 aday, ayrı dosyalar. Replikler dialogue bus'ta, karakter kadrajda neredeyse hafif pan. Dudak senkronu yok: konuşan yüzü yakın planda gösterme; konuşmayı uzaktan, sırtı dönük, ekran dışından ya da tepkiler üzerinden kur.`] : []),
    `Efekt ve ortam sesi: ${s.sfx === false ? 'yok; efekt ve ortam katmanı koyma' : 'var; görünen hareketlere efekt, sahnelere ortam sesi'}`,
    `Metin: ${s.scriptMode === 'own' ? 'kullanıcının kendi metni (aşağıda)' : 'sen yaz'}`,
    `Müzik: ${({ open: 'açık lisanslı gerçek bir kayıt, sen seç', code: 'kodla yazılsın', own: 'kullanıcının kendi dosyası', none: 'müzik yok' })[s.music] || 'sen seç'}`,
    `Altyazı: ${s.captions ? 'var' : 'yok'}`,
  ].join('\n');
}

function claudeJSON(prompt, schema, model = 'sonnet') {
  return new Promise((ok, no) => {
    const p = spawnClaude(['-p', '--model', model, '--output-format', 'json', '--tools', '', '--json-schema', JSON.stringify(schema)], { cwd: DATA, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.stdin.end(prompt);
    const t = setTimeout(() => killTree(p), 150000);
    p.on('error', e => { clearTimeout(t); no(new Error('claude çalıştırılamadı: ' + e.message)); });
    p.on('close', () => {
      clearTimeout(t);
      try { const d = JSON.parse(out); if (d.structured_output) return ok(d.structured_output); throw new Error(d.result || 'boş yanıt'); }
      catch (e) { no(new Error((err.trim().split('\n').pop() || e.message).slice(0, 300))); }
    });
  });
}

function listRefs(dir) {
  try {
    return fs.readdirSync(dir).filter(f => !f.startsWith('.')).slice(0, 40).join(', ');
  } catch { return ''; }
}

async function makeQuestions({ idea, settings: s, refVideo, refFolder, refImages, script }) {
  const prompt = `Sen cinecode ile film yapan bir yönetmen asistanısın. Kullanıcı bir video fikri verdi; üretim başlamadan önce ona soracağın soruları hazırla.

Fikir: ${idea}
${refVideo ? 'Kullanıcı bir referans video ekledi: buna benzeyen ama fikre göre değişen bir film istiyor.\n' : ''}${refImages?.length ? `Kullanıcı ${refImages.length} referans görsel ekledi (${refImages.map(f => path.basename(f)).join(', ')}). Görünüş bu görsellerden gelecek; görsel dil sorusunu buna göre kur.\n` : ''}${refFolder ? `Kullanıcı bir referans klasörü bağladı (${listRefs(refFolder)}). Görünüş bu referanslardan gelecek; görsel dil sorusunu buna göre kur.\n` : ''}
${script ? `Kullanıcı metni kendisi yazdı; metnin içeriğini ya da kelimelerini sorma, görüntü ve tonla ilgili sor. Metin: «${script.slice(0, 3000)}»\n` : ''}
Kullanıcının zaten seçtiği ayarlar (bunları ASLA tekrar sorma):
${describeSettings(s)}

Kurallar:
- 3 ile 5 soru. Yalnız bu fikre özgü, filmi gerçekten değiştiren kararlar: hikâyenin açısı ya da yorumu, ton ve duygu, görsel dil (somut bir sinema yönü), anlatıcı ya da karakter, açılış kancası, final.
- Her soruda 2 ile 4 seçenek. Önerdiğini ilk sıraya koy ve label sonuna " ★" ekle. hint: o seçeneğin filme etkisini anlatan tek kısa cümle.
- Kodla iyi çizilemeyen şeyler (gerçekçi insan yüzü, gerçekçi hayvan) ana özne olacaksa ★ seçenek fikri korusun, gösterim biçimini değiştirsin.
- id: kısa İngilizce slug. multi: yalnız gerçekten çoklu seçimse true.
- title: filme kısa bir çalışma adı (en fazla 4 kelime)${s.lang === 'en' ? ', İngilizce (filmin dili)' : ''}.
- Soru, seçenek ve hint'ler Türkçe (panel Türkçe); filmin dili ${s.lang === 'en' ? 'İngilizce olsa da' : 'Türkçe'}. Bir seçenek filmdeki bir cümleyi örnekliyorsa o cümle filmin dilinde olabilir. Doğal ve kısa. Uzun tire kullanma. "X değil, Y" kalıbı yok.`;
  return claudeJSON(prompt, Q_SCHEMA);
}

// ---------- live reload ----------
const liveClients = new Set();
let uiVersion = Date.now(), liveTimer = null;
try { fs.watch(DIR, (ev, f) => { if (f !== 'index.html') return; clearTimeout(liveTimer); liveTimer = setTimeout(() => { uiVersion = Date.now(); for (const r of liveClients) r.write(`data: ${uiVersion}\n\n`); }, 250); }); } catch {}

// ---------- script and cut (shown to the user before production) ----------
const PLAN_SCHEMA = { type: 'object', required: ['title', 'logline', 'look', 'scenes'], properties: {
  title: { type: 'string' }, logline: { type: 'string' }, look: { type: 'string' },
  scenes: { type: 'array', items: { type: 'object', required: ['t0', 't1', 'shot', 'text', 'sound'], properties: {
    t0: { type: 'number' }, t1: { type: 'number' }, shot: { type: 'string' }, text: { type: 'string' }, sound: { type: 'string' },
  } } },
} };
const tc = sec => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const planText = p => p.scenes.map((c, i) => `${i + 1}. ${tc(c.t0)}-${tc(c.t1)} | Görüntü: ${c.shot}${c.text ? ` | Metin: «${c.text}»` : ''}${c.sound ? ` | Ses: ${c.sound}` : ''}`).join('\n');
function answersText(questions = [], answers = {}) {
  return questions.map(q => { const a = answers[q.id]; if (!a || (Array.isArray(a) && !a.length)) return null; return `- ${q.q} → ${Array.isArray(a) ? a.join(', ') : a}`.replace(/ ★/g, ''); }).filter(Boolean).join('\n');
}
async function makePlan(b) {
  const s = b.settings, wps = s.lang === 'en' ? 2.5 : 2.2, n = Math.max(3, Math.min(24, Math.round(s.seconds / (s.mode === 'film' ? 6 : 3))));
  const prompt = `Sen cinecode ile kodla film yapan bir yönetmensin. Üretim başlamadan önce kullanıcıya göstereceğin senaryoyu ve kurguyu (sahne listesi) yaz.

Fikir: ${b.idea}
${describeSettings(s)}
${b.refImages?.length ? `Referans görseller: ${b.refImages.map(f => path.basename(f)).join(', ')} (görünüş bunlardan gelecek).\n` : ''}${b.refFolder ? `Referans klasörü: ${listRefs(b.refFolder)}\n` : ''}${b.refVideo ? 'Referans video var: biçimini ve ritmini tekrarla.\n' : ''}${b.notes ? `Kullanıcının notu: ${b.notes}\n` : ''}
Kullanıcının soru cevapları:
${answersText(b.questions, b.answers) || '- (yok: kararları sen ver)'}
${b.script ? `\nKullanıcının kendi metni. Kelimelerini AYNEN kullan, değiştirme, kısaltma, ekleme yapma; yalnız sahnelere böl:\n«${b.script.slice(0, 20000)}»\n` : ''}${b.prev ? `\nÖnceki senaryo:\n${planText(b.prev)}\nKullanıcının bu senaryo için notu: ${b.note || '(not yok, yeniden yaz)'}\nNotu uygula; notun dokunmadığı yerleri koru.\n` : ''}
Kurallar:
- Toplam süre tam ${s.seconds} saniye: ilk sahne t0=0, son sahne t1=${s.seconds}, sahneler boşluksuz art arda. Yaklaşık ${n} sahne.
- shot: kamerada ne görünüyor, tek somut cümle; kamera hareketi ya da plan ölçeği dahil. Kodla iyi çizilebilecek şeyler (ışık, doku, şekil, tipografi, soyut ve stilize dünya). Gerçekçi insan yüzü ana özne olmasın.
- text: ${talk(s).dlg ? `o sahnede konuşulanlar, her satır "Ad: replik" biçiminde${talk(s).narr ? '; anlatım satırları "Anlatıcı: ..."' : '; anlatıcı yok'}. Karakterleri sen belirle (en fazla 4). KATI SINIR: sahnedeki toplam kelime ≤ sahne süresi × ${wps}; replikler kısa, gündelik konuşma. Yazmadan önce say.` : s.voice !== 'none' ? `o sahnede seslendirilecek anlatım. KATI SINIR: kelime sayısı ≤ sahne süresi × ${wps} (ör. 4 saniyelik sahne en fazla ${Math.floor(4 * wps)} kelime). Toplam anlatım en fazla ${Math.floor(s.seconds * wps * 0.9)} kelime; nefes payı bırak. Yazmadan önce her sahnenin kelimesini say.` : 'anlatım yok; yalnız gerekiyorsa ekranda kısa yazı (sahne süresi × 2 kelimeyi geçmesin), çoğu sahnede boş bırak.'}
- sound: ${s.sfx === false ? 'müzik notu, kısa; efekt ve ortam sesi kapalı, yazma.' : 'efekt, ortam ve müzik notu, kısa.'}
- title: en fazla 4 kelimelik çalışma adı. logline: filmi anlatan tek cümle. look: görsel dil, tek kısa satır (renk, ışık, doku).
- Dil: text ve title filmin dilinde (${s.lang === 'en' ? 'İngilizce' : 'Türkçe'}); shot, sound, logline ve look Türkçe (panel Türkçe). Doğal ve kısa. Uzun tire kullanma.`;
  let p = fitPlan(await claudeJSON(prompt, PLAN_SCHEMA), s);
  // The narration must fit its scene: one corrective pass when a scene overflows.
  const over = p.scenes.map((c, i) => ({ i, w: words(c.text), cap: Math.floor((c.t1 - c.t0) * wps) })).filter(x => x.w > x.cap);
  if (over.length && !b.script) {
    const fix = `${prompt}\n\nİlk denemende bu sahnelerin metni süresine SIĞMADI (saniyede ${wps} kelime):\n${over.map(x => `- ${x.i + 1}. sahne: ${x.w} kelime, en fazla ${x.cap}`).join('\n')}\nÖnceki senaryo:\n${planText(p)}\nAynı senaryoyu koru; yalnız taşan metinleri kısalt ya da sahne sürelerini metne göre yeniden dağıt (toplam yine ${s.seconds} saniye).`;
    p = fitPlan(await claudeJSON(fix, PLAN_SCHEMA), s);
  }
  return p;
}
const words = t => (String(t || '').trim().match(/\S+/g) || []).length;
// Scenes back to back from 0 to the chosen length, whatever times the model returned.
function fitPlan(p, s) {
  p.scenes = (p.scenes || []).filter(c => c && c.shot);
  const lens = p.scenes.map(c => Math.max(1, (+c.t1 || 0) - (+c.t0 || 0))), sum = lens.reduce((a, x) => a + x, 0) || 1;
  let t = 0;
  p.scenes.forEach((c, i) => { const len = i === p.scenes.length - 1 ? s.seconds - t : Math.max(1, Math.round(lens[i] * s.seconds / sum * 10) / 10); c.t0 = Math.round(t * 10) / 10; t += len; c.t1 = Math.round(t * 10) / 10; });
  return p;
}

// ---------- production brief ----------
const RESULT_DIR = '00 Sonuç';
const RENDER_RULES = `Verimli render kuralları (Cinecode Studio):
- Yalnız sesi değiştiren her düzeltmede (seviye, efekt, müzik, anlatım) görüntüyü yeniden render etme: make.py draft --sound-only ya da make.py final --sound-only kullan; video kopyalanır, yalnız ses yeniden kurulur. Kendi kontrol turlarında da böyle.
- Yalnız altyazı değişiyorsa yalnız .srt'yi ve altyazı katmanını yenile; görüntüyü baştan render etme.
- Görüntü değişince yeniden render et, ama kontrol turlarını gerçek hatalarla sınırla; gözle fark edilmeyen ince ayar için yeni sürüm çıkarma.
- Ara taslaklar renders/ altında kalsın. Film klasörünün köküne yalnız teslim dosyalarını koy (film MP4'ü, .srt, künye).
- "${RESULT_DIR}" klasörüne dokunma; onu uygulama yönetir.`;
// Mirror the deliverables into "<film>/00 Sonuç" so the user finds the result at once in Finder.
function syncResult(job) {
  try {
    const dir = findFilmDir(job); if (!dir) return null;
    const out = outputs(job), vids = out.videos.filter(v => !/[\\/]renders[\\/]/.test(v.path));
    const finals = vids.filter(v => v.kind === 'final');
    const edits = vids.filter(v => v.kind === 'edit').slice(0, 1);
    const chosen = finals.length || edits.length ? [...finals, ...edits] : vids.filter(v => v.kind === 'draft').slice(0, 1);
    if (!chosen.length) return null;
    const rdir = path.join(dir, RESULT_DIR);
    fs.mkdirSync(rdir, { recursive: true });
    for (const f of fs.readdirSync(rdir)) { const p = path.join(rdir, f); if (fs.statSync(p).isFile()) fs.unlinkSync(p); }
    const put = (src, name) => { const dst = path.join(rdir, name); try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); } return dst; };
    // Main file first: the plain final (no caption/draft suffix), else the newest chosen.
    const main = chosen.find(v => !/-(altyazili|draft|taslak)\.mp4$/i.test(v.name)) || chosen[0];
    const res = put(main.path, main.name);
    for (const v of chosen) if (v !== main) put(v.path, v.name);
    for (const f of fs.readdirSync(dir)) if (/\.srt$/i.test(f)) put(path.join(dir, f), f);
    if (fs.existsSync(path.join(dir, 'LICENSES.csv'))) put(path.join(dir, 'LICENSES.csv'), 'kunye-lisanslar.csv');
    job.resultPath = res;
    return res;
  } catch { return null; }
}
function brief(job) {
  const s = job.settings, [w, h] = sizeOf(s);
  const answers = (job.questions || []).map(q => {
    const a = job.answers?.[q.id]; if (!a || (Array.isArray(a) && !a.length)) return null;
    return `- ${q.q} → ${Array.isArray(a) ? a.join(', ') : a}`.replace(/ ★/g, '');
  }).filter(Boolean).join('\n');
  const deliver = s.deliver === 'final'
    ? 'Kullanıcı taslak onayını önceden verdi: taslağı üretip kendi kontrollerini (make.py check, qc, words_check, ses ölçümü) geçtikten sonra tam boy finali de çıkar ve -14 LUFS master ile teslim et.'
    : 'Taslakta dur: yarım boy taslağı üret, kendi kontrollerini geçir, teslim et ve kullanıcının notlarını bekle. Finali kullanıcı isteyince çıkaracaksın.';
  const py3 = WIN ? 'py -3' : 'python3';
  return `${RENDER_RULES}

cinecode skill'ini Skill aracıyla yükle ve bu filmi üret. Bu oturum "Cinecode Studio" masaüstü uygulamasından, ekransız (claude -p) çalışıyor.

## Brief (tam brief: soru sorma, doğrudan işe başla)
Fikir: ${job.idea}
Çalışma adı: ${job.title}
${describeSettings(s)}
Final boyutu: --size ${w}x${h}, ${s.fps} fps. Taslak bunun yarısı.
${s.voice !== 'none' ? `Seslendirme motoru: tts.py --engine ${s.voice}.` : (s.sfx === false && s.music === 'none' ? 'Anlatım, efekt ve müzik yok: kullanıcı sessiz film istedi, ses katmanı koyma.' : `Anlatım yok: konuşma, seslendirme ya da diyalog koyma; film sesini ${[s.sfx !== false && 'ortam ve efekt', s.music !== 'none' && 'müzik'].filter(Boolean).join(' ile ')} taşır.`)}
${s.music === 'own' && job.musicFile ? `Müzik dosyası: ${job.musicFile} (filme kopyala; kurgu beat grid ile ona otursun).` : ''}
${job.appVideos?.length ? `Uygulamanın gerçek ekran kayıtları (promonun kahramanı; en iyi anları kes, telefon çerçevesinde göster, arayüzü uydurma):\n${job.appVideos.map(f => '- ' + f).join('\n')}\nBunları filmin refs/ klasörüne kopyala; ffprobe ile süre ve boyutu ölç, kullanacağın anları saniyeyle seç.` : ''}
${job.refVideo ? `Referans video: ${job.refVideo} (references/reference-video.md yolunu izle; biçimi tekrarla, sahneleri değil).` : ''}
${job.refImages?.length ? `${s.purpose === 'app' ? 'Uygulamanın gerçek ekran görüntüleri (promonun kahramanı; arayüzü bunlardan al, uydurma)' : 'Referans görseller'}:\n${job.refImages.map(f => '- ' + f).join('\n')}\nBunları filmin refs/ klasörüne kopyala ve oku. Renk, ışık, doku ve kadraj bu görsellerden gelir; görselleri filme olduğu gibi koyma.` : ''}
${job.refFolder ? `Referans klasörü: ${job.refFolder}\nİçindekiler: ${listRefs(job.refFolder)}\nGörselleri ve kısa klipleri filmin refs/ klasörüne kopyala (1 GB üstü videoyu kopyalama, yolunu yaz). Referans sorusu "yalnız benimkiler" sayılır: görünüş, renk ve ritim bu klasörden okunur.` : ''}
${job.notes ? `Kullanıcının ek notu: ${job.notes}` : ''}
${job.script ? `
## Kullanıcının metni (senaryo / anlatım)
Bu metin filmin sözüdür: kelimeleri değiştirme, kısaltma ya da yeniden yazma; yalnız sahnelere böl ve zamanla. Anlatım varsa bu satırlar seslendirilir, yoksa ekranda yazı olarak kullanılır. Metin seçilen süreye sığmıyorsa süreyi metne göre ayarla ve STATE.md'ye yaz.
«
${job.script}
»` : ''}

Kullanıcının soru cevapları:
${answers || '- (cevap yok: kararları sen ver)'}
${job.plan?.scenes?.length ? `
## Onaylı senaryo ve kurgu
Kullanıcı bu senaryoyu panelde okudu ve onayladı. Sahne sırası, süreler ve metin bağlayıcıdır; metin kelimeleri aynen kullanılır. Görüntü ve ses notları yön verir: zanaatın gerektirdiği küçük düzeltmeleri yapabilirsin, yaptıysan STATE.md'ye nedeniyle yaz. Kartı ve senaryoyu bunun üstüne kur; bu kararları yeniden sorma.
Ad: ${job.plan.title}
Logline: ${job.plan.logline}
Görsel dil: ${job.plan.look}
${planText(job.plan)}
` : ''}
## Çalışma biçimi
- Film klasörünü bu klasörde aç: ${py3} "${KIT}${path.sep}scripts${path.sep}init_film.py" <kısa-ad>${s.mode === 'film' ? '' : ' --quick'} --title "${job.title.replace(/"/g, '')}"
- Kullanıcı tüm açık kararları sana bıraktı (Pace: through). Her seçimi ★ ile yap ve STATE.md'ye "(★, kullanıcı bana bıraktı)" diye yaz. Müzik adayını da sen seç ve nedenini yaz.
- STATE.md'deki Phase ve Next action satırlarını her aşamada güncel tut; uygulama ilerlemeyi oradan gösterir.
- Soru aracı yok. Gerçek bir engel dışında (eksik API anahtarı, para, yasal sınır) durma, soru sorma. Engel çıkarsa turu kısa, numaralı tek bir soruyla bitir.
- Ücretli servis, büyük indirme veya kurulum gerekiyorsa yapma; turu bitirip ne gerektiğini yaz.
- Görsel ya da video gösterirken tam dosya yolunu kendi satırına yaz; uygulama onu ekranda gösterir.
- Kısa ilerleme notları yaz (Türkçe, tek satır): şu an ne yapıyorsun, ne kadar sürer.
- ${deliver}
- Son mesajda: üretilen MP4'ün tam yolu, süresi, senin seçtiklerin (3-5 madde) ve kullanıcının dinlemesi gereken saniyeler.`;
}

// ---------- video clone brief (HyperFrames reverse-any-video) ----------
function cloneBrief(job) {
  const out = path.join(job.filmDir, slug(job.title) + '.mp4');
  return `/hyperframes:reverse-any-video skill'ini yükle ve kurallarına uyarak bu videoyu düzenlenebilir bir HyperFrames projesi olarak yeniden kur.

Video: ${job.refVideo}
Proje klasörü: ${job.filmDir} (şu an buradasın; projeyi burada kur)
${job.settings?.cloneMode === 'remix' ? `İSTEK: bu videonun kalıbıyla YENİ bir video (remix). Kullanıcı bunu açıkça istedi.
Yeni konu: ${job.idea}
${job.script ? `Kullanıcının metni (kelimeleri aynen kullan; videodaki yazı ve anlatım yerlerine dağıt):\n«${job.script}»` : 'Metni sen yaz: videodaki her yazı ve anlatımın yerine, aynı uzunlukta (kelime sayısı ve satır kırılımı benzer) ve aynı tonda, yeni konuya ait metin koy.'}
Korunacaklar: boyut, kare hızı, süre, kesme zamanları, plan sırası ve kompozisyon, hareket ve geçişler, yazı stili ve yerleşimi, ritim. Değişecekler: konu, metin, konuya ait görseller (logo, ürün, ekran; uydurma marka kullanma), gerekirse renkler.
Orijinalin sesi telif ya da konu nedeniyle uymuyorsa müziği açık lisanslı benzer bir kayıtla değiştir ve REVERSE.md'ye yaz. Önce videoyu ölç ve kur, sonra içeriği değiştir.` : job.idea ? `Kullanıcının istediği değişiklikler (remix): ${job.idea}\nÖnce videoyu olduğu gibi kur, sonra bu değişiklikleri uygula; değişiklik dışındaki her şey orijinale sadık kalsın.` : 'Değişiklik istenmedi: videoyu olduğu gibi kur.'}
${job.notes ? `Ek not: ${job.notes}` : ''}

## Sınırlar
- Kullanıcı bu videoyu kullanma hakkına sahip olduğunu beyan etti.
- Reverse bir HyperFrames Pro özelliği. "reverse start" reddederse dur: nedenini ve yükseltme linkini tek mesajda yaz, "billing" komutunu ASLA çalıştırma. Kullanıcı yükseltince "Kaldığı yerden devam" der.
- Ücretli adım yok: HeyGen ile kişi yeniden çekimi, avatar, ses klonu, görsel ya da video üretimi YAPMA. Ekranda gerçek bir kişi varsa onu orijinalden kendi kutusunda kes ve bunu REVERSE.md'ye yaz.
- Render YALNIZ yerel: npx hyperframes render -o "${out}" (cloud render yok). Uzun sürerse arka planda başlatıp log'u bekle.
- Soru aracı yok; gerçek bir engel dışında durma.
- Kısa Türkçe ilerleme notları yaz (tek satır: ne yapıyorsun, ne kadar sürer). Ara kareleri gösterirken tam dosya yolunu kendi satırına yaz.
- Son mesajda: MP4'ün tam yolu, son diff sonuçları (kısa), neyin birebir neyin yaklaşık olduğu (3-5 madde).`;
}

// ---------- HyperFrames edit brief ----------
const EDIT_OPS = {
  captions: 'Kelime kelime altyazı ekle (sesi yazıya dök, okunur ve güvenli alanda; references/captions.md).',
  title: 'Açılışa filmin adıyla kısa bir başlık kartı ekle.',
  lower: 'Gerektiği yerlere alt bant yazısı (isim, yer, tarih) ekle (references/overlays.md).',
  logo: 'Köşeye logo ya da filigran koy.',
  endcard: 'Sona bir bitiş kartı ekle (kanal adı ya da çağrı).',
  transitions: 'Kesmelerde filme uyan geçişler kullan (registry bloklarına bak).',
  music: 'Müziği ekle ya da değiştir, sesi -14 LUFS dengele.',
  sfx: 'Görünen hareketlere ses efektleri ekle.',
  look: 'Renk ve görünüşü düzelt (media-treatment ile, CSS filtresi değil).',
  reframe: 'Videoyu dikey 9:16 sürüme yeniden çerçevele (öznenin yerini koru).',
};
function editBrief(job, { text, ops, source, n, logo }) {
  const out = path.join(job.filmDir || settings.filmsRoot, 'edits', `${slug(job.title)}-duzenleme-${n}.mp4`);
  return { out, prompt: `hyperframes:hyperframes skill'ini Skill aracıyla yükle ve bu videoyu HyperFrames ile düzenle. Bu oturum "Cinecode Studio" uygulamasından ekransız çalışıyor; soru aracı yok.

Kaynak video: ${source}
Proje klasörü: ${path.join(path.dirname(out), `edit-${n}`)} (yoksa: npx hyperframes init <klasör> --skip-skills --skill=hyperframes; kaynağı assets/ içine kopyala)
Çıktı: ${out}

İstenenler:
${(ops || []).map(o => '- ' + (EDIT_OPS[o] || o)).join('\n') || '- (hazır seçim yok)'}
${logo ? `- Logo dosyası: ${logo}` : ''}
${text ? `- Kullanıcının notu: ${text}` : ''}

Kurallar:
- Kaynak video tam süre, aynı boyut ve fps ile alt katmandır; yalnız istenenleri ekle, filmi yeniden kurma.
- Render YALNIZ yerel: npx hyperframes render -o "${out}" (ön planda, 10 dakika zaman aşımı). "cloud render", billing, auth ve HeyGen'in ücretli üretimleri (avatar, ses klonu, video/görsel üretimi) YASAK; ücretsiz yerel araçları kullan.
- Render öncesi npx hyperframes check, hatalarını düzelt.
- Kısa Türkçe ilerleme notları yaz. Son mesajda çıktının tam yolu ve yaptıklarının 3-5 maddelik listesi.` };
}
const slug = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'film';

// ---------- job events ----------
const logPath = id => example && id === example.id ? path.join(EXAMPLE_DIR, 'log.jsonl') : path.join(LOGS, id + '.jsonl');
function emit(job, ev) {
  ev.t = Date.now();
  fs.appendFileSync(logPath(job.id), JSON.stringify(ev) + '\n');
  for (const res of clients.get(job.id) || []) res.write(`data: ${JSON.stringify(ev)}\n\n`);
}
const publicJob = j => { const { _seen, ...rest } = j; return { ...rest, running: procs.has(j.id), estimate: estimate(j.mode, j.seconds) }; };
const pushJob = job => { for (const res of clients.get(job.id) || []) res.write(`event: job\ndata: ${JSON.stringify(publicJob(job))}\n\n`); };

function toolLine(name, input = {}) {
  switch (name) {
    case 'Bash': case 'PowerShell': return input.description || String(input.command || '').slice(0, 160);
    case 'Read': return 'Okuyor: ' + path.basename(input.file_path || '');
    case 'Write': return 'Yazıyor: ' + path.basename(input.file_path || '');
    case 'Edit': case 'MultiEdit': return 'Düzenliyor: ' + path.basename(input.file_path || '');
    case 'Skill': return 'Skill yüklendi: ' + (input.skill || input.command || '');
    case 'WebSearch': return 'Arıyor: ' + (input.query || '');
    case 'WebFetch': return 'Sayfa okuyor: ' + (input.url || '');
    case 'Agent': case 'Task': return 'Yardımcı ajan: ' + (input.description || '');
    case 'TodoWrite': case 'ToolSearch': return null;
    default: return name;
  }
}

// The film folder: a STATE.md folder made in filmsRoot after the job started, not owned by another job.
function findFilmDir(job) {
  if (job.filmDir && fs.existsSync(job.filmDir)) return job.filmDir;
  const taken = new Set(jobs.filter(j => j.id !== job.id && j.filmDir).map(j => j.filmDir));
  const cands = [];
  const scan = (dir, depth) => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) if (e.isDirectory() && !e.name.startsWith('.')) {
      const p = path.join(dir, e.name);
      if (fs.existsSync(path.join(p, 'STATE.md'))) {
        const st = fs.statSync(p), born = st.birthtimeMs || st.ctimeMs;
        if (born >= job.created - 5000 && !taken.has(p)) cands.push([born, p]);
      } else if (depth < 1) scan(p, depth + 1);
    }
  };
  scan(settings.filmsRoot, 0);
  cands.sort((a, b) => a[0] - b[0]);
  if (cands[0]) { job.filmDir = cands[0][1]; saveJobs(); }
  return job.filmDir;
}

// Phase and next action from STATE.md, so the stepper shows where the film really is.
function filmState(dir) {
  let t = ''; try { t = fs.readFileSync(path.join(dir, 'STATE.md'), 'utf8'); } catch { return {}; }
  const val = k => { const m = t.match(new RegExp(`\\*\\*${k}:\\*\\*\\s*([^\\n<]*)`)); return m ? m[1].trim() : ''; };
  const phase = val('Phase'), next = val('Next action');
  return { phase: phase.replace(/\s*<!--.*$/, ''), next, quick: /Quick mode/.test(t.slice(0, 200)) };
}

function outputs(job) {
  const dir = findFilmDir(job); if (!dir) return { videos: [], stills: [], state: {} };
  const list = (sub, re, tag) => {
    try {
      return fs.readdirSync(path.join(dir, sub)).filter(f => re.test(f) && !f.startsWith('.')).map(f => {
        const p = path.join(dir, sub, f), st = fs.statSync(p);
        return { path: p, name: f, mtime: st.mtimeMs, size: st.size, kind: tag };
      }).filter(x => x.size > 0);
    } catch { return []; }
  };
  const videos = [...list('.', /\.mp4$/i, 'final'), ...list('renders', /\.mp4$/i, 'render'), ...list('edits', /\.mp4$/i, 'edit')]
    .sort((a, b) => b.mtime - a.mtime);
  for (const v of videos) if (v.kind !== 'edit' && /draft|taslak/i.test(v.name)) v.kind = 'draft'; else if (v.kind === 'render') v.kind = 'render';
  const stills = list('review', /\.(png|jpe?g|webp)$/i, 'still').sort((a, b) => b.mtime - a.mtime).slice(0, 24);
  return { videos, stills, state: filmState(dir) };
}

function startTurn(job, prompt, { resume, kind = 'film' } = {}) {
  const sessionKey = kind === 'edit' ? 'editSessionId' : 'sessionId';
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions',
    '--disallowedTools', 'AskUserQuestion', '--append-system-prompt', 'Bu oturum Cinecode Studio uygulamasından ekransız çalışıyor; kullanıcı yalnız senin metin mesajlarını ve yazdığın dosya yollarını görür. Yanıtlar Türkçe.'];
  if (resume && job[sessionKey]) args.push('--resume', job[sessionKey]);
  const cwd = (kind === 'edit' || job.kind === 'clone') && job.filmDir ? job.filmDir : settings.filmsRoot;
  const child = spawnClaude(args, { cwd, detached: !WIN, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(prompt);
  procs.set(job.id, child);
  job.status = 'running'; job.turnKind = kind; job.turnStart = Date.now(); job.note = ''; saveJobs(); pushJob(job);
  let buf = '';
  child.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) handle(job, line, sessionKey); }
  });
  let err = '';
  child.stderr.on('data', d => { err = (err + d).slice(-4000); });
  child.on('error', e => { err += e.message; });
  child.on('close', code => {
    procs.delete(job.id);
    job.workMs = (job.workMs || 0) + (Date.now() - job.turnStart);
    if (job.status === 'running') {
      job.status = code === 0 ? 'waiting' : 'error';
      if (code !== 0) { job.note = err.trim().split('\n').slice(-3).join(' ') || `claude ${code} koduyla çıktı`; emit(job, { kind: 'error', text: job.note }); }
    }
    syncResult(job);
    const out = outputs(job);
    const newest = out.videos[0]?.path;
    const fresh = newest && newest !== job.lastVideo;
    if (newest) job.lastVideo = newest;
    saveJobs(); pushJob(job); emit(job, { kind: 'outputs', ...out });
    if (job.status === 'waiting') notify('Cinecode Studio', fresh ? `${job.title}: yeni video hazır` : `${job.title}: senden bir cevap bekliyor`);
  });
}

function handle(job, line, sessionKey) {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.type === 'system' && m.subtype === 'init') { if (m.session_id && job[sessionKey] !== m.session_id) { job[sessionKey] = m.session_id; saveJobs(); } return; }
  if (m.type === 'assistant') {
    for (const c of m.message?.content || []) {
      if (c.type === 'text' && c.text.trim()) emit(job, { kind: 'text', text: c.text, turn: job.turnKind });
      if (c.type === 'tool_use') { const l = toolLine(c.name, c.input); if (l) emit(job, { kind: 'tool', name: c.name, text: l }); }
    }
    return;
  }
  if (m.type === 'user') {
    const out = outputs(job), sig = out.videos.map(v => v.path + v.size).join() + out.stills.length + (out.state.phase || '');
    if (sig !== job._seen) { job._seen = sig; emit(job, { kind: 'outputs', ...out }); }
    return;
  }
  if (m.type === 'result') {
    job.cost = (job.cost || 0) + (m.total_cost_usd || 0);
    if (m.is_error) emit(job, { kind: 'error', text: m.result || 'Hata' });
    else if (m.result) emit(job, { kind: 'result', text: m.result });
  }
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4' };

function serveFile(req, res, p) {
  let st; try { st = fs.statSync(p); if (!st.isFile()) throw 0; } catch { return send(res, 404, 'yok', 'text/plain'); }
  const type = MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(p, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': st.size, 'cache-control': 'no-cache' });
  fs.createReadStream(p).pipe(res);
}

function newJob(b) {
  const job = { id: Date.now().toString(36), created: Date.now(), title: (b.title || 'Yeni film').slice(0, 60), idea: b.idea, notes: b.notes || '',
    settings: b.settings, mode: b.settings.mode, seconds: b.settings.seconds, questions: b.questions || [], answers: b.answers || {},
    musicFile: b.musicFile || null, refVideo: b.refVideo || null, appVideos: (Array.isArray(b.appVideos) ? b.appVideos : []).filter(f => typeof f === 'string' && VIDEO_RE.test(f) && fs.existsSync(f)).slice(0, 8), refFolder: b.refFolder || null, plan: b.plan && Array.isArray(b.plan.scenes) ? { title: String(b.plan.title || ''), logline: String(b.plan.logline || ''), look: String(b.plan.look || ''), scenes: b.plan.scenes.slice(0, 60).map(c => ({ t0: +c.t0 || 0, t1: +c.t1 || 0, shot: String(c.shot || '').slice(0, 600), text: String(c.text || '').slice(0, 2000), sound: String(c.sound || '').slice(0, 300) })) } : null, refImages: (Array.isArray(b.refImages) ? b.refImages : []).filter(f => typeof f === 'string' && /\.(png|jpe?g|webp|svg|gif|heic)$/i.test(f) && fs.existsSync(f)).slice(0, 12), script: (b.script || '').slice(0, 60000), status: 'queued', cost: 0, edits: 0 };
  if (b.kind === 'clone') {
    job.kind = 'clone'; job.mode = 'clone';
    let dir = path.join(settings.filmsRoot, slug(job.title) + '-klon'), n = 2;
    while (fs.existsSync(dir)) dir = path.join(settings.filmsRoot, `${slug(job.title)}-klon-${n++}`);
    fs.mkdirSync(dir, { recursive: true }); job.filmDir = dir;
  }
  jobs.push(job); saveJobs();
  return job;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  try {
    if (!new RegExp(`^(localhost|127\\.0\\.0\\.1):${PORT}$`).test(req.headers.host || '')) return send(res, 403, { error: 'host' });
    if (req.method !== 'GET' && req.headers['x-cs'] !== '1') return send(res, 403, { error: 'izin yok' });
    if (p === '/' || p === '/index.html') return serveFile(req, res, path.join(DIR, 'index.html'));
    if (p.startsWith('/assets/')) { const f = path.join(DIR, 'assets', path.basename(p)); return serveFile(req, res, f); }
    if (p === '/api/status') return send(res, 200, await status());
    if (p === '/api/estimate') return send(res, 200, estimate(u.searchParams.get('mode'), +u.searchParams.get('seconds') || 30));
    if (p === '/api/jobs' && req.method === 'GET') return send(res, 200, allJobs().slice().sort((a, b) => b.created - a.created).map(publicJob));
    if (p === '/file') {
      const f = path.resolve(u.searchParams.get('p') || '');
      return allowedFile(f) ? serveFile(req, res, f) : send(res, 403, 'izin yok', 'text/plain');
    }
    if (p === '/thumb') {
      // Tray preview: images as they are, videos as one frame at 1 s, cached per file version.
      const f = path.resolve(u.searchParams.get('p') || '');
      if (!allowedFile(f) || !fs.existsSync(f)) return send(res, 403, 'izin yok', 'text/plain');
      if (!VIDEO_RE.test(f)) return serveFile(req, res, f);
      const st = fs.statSync(f), key = Buffer.from(f).toString('base64url').slice(-40), out = path.join(DATA, 'posters', `t-${key}-${Math.round(st.mtimeMs)}.jpg`);
      if (!fs.existsSync(out)) {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await run('ffmpeg', ['-y', '-ss', '1', '-i', f, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '5', out]);
        if (!fs.existsSync(out)) await run('ffmpeg', ['-y', '-i', f, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '5', out]);
      }
      return fs.existsSync(out) ? serveFile(req, res, out) : send(res, 404, 'yok', 'text/plain');
    }
    if (p.startsWith('/poster/')) {
      // Library cover: one frame from the middle of the latest video, cached per video version.
      const job = allJobs().find(j => j.id === p.slice(8));
      const v = job && (job.lastVideo && fs.existsSync(job.lastVideo) ? job.lastVideo : outputs(job).videos[0]?.path);
      if (!v) return send(res, 404, 'yok', 'text/plain');
      const st = fs.statSync(v), out = path.join(DATA, 'posters', `${job.id}-${Math.round(st.mtimeMs)}.jpg`);
      if (!fs.existsSync(out)) {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const d = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', v]);
        const at = Math.max(0, (parseFloat(d.out) || 2) * 0.45).toFixed(2);
        await run('ffmpeg', ['-y', '-ss', at, '-i', v, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', out]);
      }
      return fs.existsSync(out) ? serveFile(req, res, out) : send(res, 404, 'yok', 'text/plain');
    }
    if (p === '/api/pick' && req.method === 'POST') {
      const { kind } = JSON.parse(await readBody(req));
      if (kind === 'media') {
        const paths = (await pickMedia()).filter(f => MEDIA_RE.test(f) && fs.existsSync(f));
        paths.forEach(f => picked.add(f));
        return send(res, 200, { paths });
      }
      const got = await pick(kind);
      if (got && fs.existsSync(got) && fs.statSync(got).isFile()) picked.add(got);
      if (!got) return send(res, 200, { path: null });
      const isDir = fs.existsSync(got) && fs.statSync(got).isDirectory();
      if (kind === 'text') {
        if (!/\.(txt|md|srt|fountain)$/i.test(got)) return send(res, 400, { error: 'Metin için .txt, .md, .srt ya da .fountain dosyası seç.' });
        return send(res, 200, { path: got, name: path.basename(got), text: fs.readFileSync(got, 'utf8').slice(0, 60000) });
      }
      return send(res, 200, { path: got, name: path.basename(got), count: isDir ? fs.readdirSync(got).filter(f => !f.startsWith('.')).length : undefined });
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const name = (u.searchParams.get('name') || 'dosya').replace(/[^\w.\-ğüşıöçĞÜŞİÖÇ ]/g, '_').slice(-80);
      const dest = path.join(UPLOADS, Date.now() + '-' + name);
      await new Promise((ok, no) => req.pipe(fs.createWriteStream(dest)).on('finish', ok).on('error', no));
      return send(res, 200, { path: dest, name });
    }
    if (p === '/api/plan' && req.method === 'POST') {
      try { return send(res, 200, await makePlan(JSON.parse(await readBody(req, 4e6)))); } catch (e) { return send(res, 500, { error: 'Senaryo yazılamadı: ' + e.message }); }
    }
    if (p === '/api/live') {
      // Live reload: the panel reloads itself when index.html changes on disk.
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${uiVersion}\n\n`); liveClients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); liveClients.delete(res); });
      return;
    }
    if (p === '/api/questions' && req.method === 'POST') return send(res, 200, await makeQuestions(JSON.parse(await readBody(req))));
    if (p === '/api/jobs' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req));
      if (b.kind === 'clone' && !(b.refVideo && fs.existsSync(b.refVideo))) return send(res, 400, { error: 'Klonlanacak videoyu seç.' });
      const job = newJob(b);
      emit(job, { kind: 'user', text: job.kind === 'clone' ? `Klonla: ${path.basename(job.refVideo)}${job.idea ? `\n${job.idea}` : ''}` : job.idea });
      startTurn(job, job.kind === 'clone' ? cloneBrief(job) : brief(job));
      return send(res, 200, publicJob(job));
    }
    let m;
    if ((m = p.match(/^\/api\/jobs\/(\w+)(?:\/(\w+))?$/))) {
      const job = allJobs().find(j => j.id === m[1]); if (!job) return send(res, 404, { error: 'Film bulunamadı.' });
      const act = m[2];
      if (job.example && act === 'delete' && req.method === 'POST') { settings.hideExample = true; fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); return send(res, 200, { ok: true }); }
      if (job.example && act === 'fork' && req.method === 'POST') {
        // Copy the bundled example into the films folder as the user's own project, so it can be revised and edited.
        let dir = path.join(settings.filmsRoot, 'kagit-gemi'), n = 2;
        while (fs.existsSync(dir)) dir = path.join(settings.filmsRoot, `kagit-gemi-${n++}`);
        fs.mkdirSync(settings.filmsRoot, { recursive: true });
        fs.cpSync(path.join(EXAMPLE_DIR, 'film'), dir, { recursive: true });
        const copy = { ...JSON.parse(JSON.stringify(job)), id: Date.now().toString(36), created: Date.now(), title: 'Kâğıt Gemi', example: false, forkedFrom: 'ornek', filmDir: dir, status: 'waiting', workMs: 0, sessionId: null, editSessionId: null, edits: 0, note: '' };
        copy.settings = { ...copy.settings, deliver: 'final' };
        delete copy.example;
        jobs.push(copy); saveJobs();
        emit(copy, { kind: 'text', text: `Örnek proje kopyalandı: ${dir}\nNot yazıp revize edebilir ya da HyperFrames ile düzenleyebilirsin.` });
        return send(res, 200, publicJob(copy));
      }
      if (job.example && ['reply', 'edit', 'stop'].includes(act)) return send(res, 403, { error: 'Bu örnek proje; kendi filmin için Yeni proje başlat.' });
      if (!act && req.method === 'GET') return send(res, 200, { ...publicJob(job), ...outputs(job) });
      if (act === 'events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        try { for (const l of fs.readFileSync(logPath(job.id), 'utf8').split('\n')) if (l) res.write(`data: ${l}\n\n`); } catch {}
        res.write(`event: job\ndata: ${JSON.stringify(publicJob(job))}\n\n`);
        res.write(`data: ${JSON.stringify({ kind: 'outputs', ...outputs(job) })}\n\n`);
        if (!clients.has(job.id)) clients.set(job.id, new Set());
        clients.get(job.id).add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { clearInterval(ping); clients.get(job.id)?.delete(res); });
        return;
      }
      if (act === 'reply' && req.method === 'POST') {
        if (procs.has(job.id)) return send(res, 409, { error: 'Film hâlâ üretiliyor; bitince yaz.' });
        const fresh = !job.sessionId;
        if (fresh && !(job.filmDir && fs.existsSync(path.join(job.filmDir, 'STATE.md')))) return send(res, 409, { error: 'Bu filmin oturumu yok; yeni film başlat.' });
        const { text, kind } = JSON.parse(await readBody(req));
        const prompt = kind === 'final' ? 'Taslağı onaylıyorum. Tam boy finali çıkar, kontrollerini yap ve teslim et; son mesajda MP4 yolunu yaz.'
          : kind === 'resume' ? 'STATE.md\'den devam et. cinecode skill\'ini yeniden yükle ve kaldığın yerden sürdür.'
          : `Kullanıcının notu:\n${text}\n\nNotu STATE.md'deki not turuna aynen kaydet, uygula, kendi kontrollerini geçir ve yeni sürümü tam boy final olarak (-14 LUFS master) teslim et.\n\n${RENDER_RULES}`;
        emit(job, { kind: 'user', text: kind === 'final' ? 'Finali çıkar' : kind === 'resume' ? 'Kaldığı yerden devam' : text });
        startTurn(job, fresh ? `/cinecode\n\nProje klasörü: ${job.filmDir}\nBu klasörde cinecode ile yapılmış bir film var. Önce cinecode skill'ini yükle, klasöre geç ve STATE.md'yi oku; film oradan devam eder.\n\n${prompt}` : prompt, { resume: !fresh });
        return send(res, 200, publicJob(job));
      }
      if (act === 'edit' && req.method === 'POST') {
        if (procs.has(job.id)) return send(res, 409, { error: 'Film hâlâ üretiliyor; bitince düzenle.' });
        const b = JSON.parse(await readBody(req));
        if (!b.source || !allowedFile(b.source)) return send(res, 400, { error: 'Düzenlenecek videoyu seç.' });
        if (!fs.existsSync(HF_DIR)) return send(res, 409, { error: 'HyperFrames kurulu değil. Kurulum: claude plugin marketplace add heygen-com/hyperframes, sonra claude plugin install hyperframes@hyperframes' });
        findFilmDir(job);
        const sameChain = job.editSessionId && (b.source === job.lastEditOut || b.source === job.lastEditSource);
        job.edits = (job.edits || 0) + 1;
        const { out, prompt } = editBrief(job, { ...b, n: job.edits });
        fs.mkdirSync(path.dirname(out), { recursive: true });
        job.lastEditSource = b.source; job.lastEditOut = out;
        const label = [...(b.ops || []).map(o => ({ captions: 'Altyazı', title: 'Başlık kartı', lower: 'Alt bant', logo: 'Logo', endcard: 'Bitiş kartı', transitions: 'Geçişler', music: 'Müzik', sfx: 'Ses efekti', look: 'Renk', reframe: 'Dikey sürüm' })[o] || o), b.text].filter(Boolean).join(' · ');
        emit(job, { kind: 'user', text: 'Düzenleme: ' + label, turn: 'edit' });
        startTurn(job, sameChain ? `Yeni düzenleme isteği (kaynak: ${b.source}).\n\n${prompt}` : prompt, { resume: sameChain, kind: 'edit' });
        return send(res, 200, publicJob(job));
      }
      if (act === 'stop' && req.method === 'POST') {
        const c = procs.get(job.id);
        if (c) { job.status = 'stopped'; job.note = 'Sen durdurdun.'; killTree(c); saveJobs(); pushJob(job); }
        return send(res, 200, publicJob(job));
      }
      if (act === 'reveal' && req.method === 'POST') {
        const b = JSON.parse((await readBody(req)).toString() || '{}');
        const target = (b.path && allowedFile(b.path) && b.path) || (job.resultPath && fs.existsSync(job.resultPath) && job.resultPath) || job.lastVideo || findFilmDir(job) || settings.filmsRoot;
        reveal(target); return send(res, 200, { ok: true });
      }
      if (act === 'delete' && req.method === 'POST') {
        if (procs.has(job.id)) return send(res, 409, { error: 'Önce durdur.' });
        jobs = jobs.filter(j => j.id !== job.id); saveJobs(); try { fs.unlinkSync(logPath(job.id)); } catch {}
        return send(res, 200, { ok: true }); // the film folder stays on disk
      }
    }
    if (p === '/api/keys/open' && req.method === 'POST') {
      const { name } = JSON.parse(await readBody(req));
      if (!/^[A-Z0-9_]+$/.test(name)) return send(res, 400, { error: 'ad' });
      py([path.join(KIT, 'scripts', 'keys.py'), 'open', name], { cwd: HOME });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/open-root' && req.method === 'POST') { reveal(settings.filmsRoot); return send(res, 200, { ok: true }); }
    if (p === '/api/open-link' && req.method === 'POST') {
      const { url } = JSON.parse(await readBody(req));
      if (!/^https:\/\/(github\.com|x\.com)\/[\w./-]+$/.test(url || '')) return send(res, 400, { error: 'link' });
      if (MAC) run('open', [url]); else if (WIN) run('cmd', ['/c', 'start', '', url]); else run('xdg-open', [url]);
      return send(res, 200, { ok: true });
    }
    // Keys go to cinecode's own local store (~/.cinecode/keys.env, 0600) through keys.py; the value is never sent back.
    if (p === '/api/keys/set' && req.method === 'POST') {
      const { name, value } = JSON.parse(await readBody(req));
      if (!/^[A-Z0-9_]+$/.test(name) || !value || /[\r\n]/.test(value)) return send(res, 400, { error: 'Geçersiz anahtar.' });
      const r = await new Promise(ok => {
        const c = spawn(PY[0], [...PY.slice(1), path.join(KIT, 'scripts', 'keys.py'), 'set', name], { cwd: HOME, env: env(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let err = ''; c.stderr.on('data', d => err += d); c.on('close', code => ok({ code, err })); c.stdin.end(value.trim());
      });
      return r.code === 0 ? send(res, 200, { ok: true }) : send(res, 500, { error: r.err.trim().split('\n').pop() || 'Kaydedilemedi.' });
    }
    if (p === '/api/keys/remove' && req.method === 'POST') {
      const { name } = JSON.parse(await readBody(req));
      if (!/^[A-Z0-9_]+$/.test(name)) return send(res, 400, { error: 'ad' });
      await py([path.join(KIT, 'scripts', 'keys.py'), 'remove', name], { cwd: HOME });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/settings' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req));
      if (b.filmsRoot) {
        const r = path.resolve(b.filmsRoot);
        try { fs.mkdirSync(r, { recursive: true }); fs.accessSync(r, fs.constants.W_OK); } catch { return send(res, 400, { error: 'Bu klasöre yazılamıyor.' }); }
        settings.filmsRoot = r;
      }
      if (typeof b.hideExample === 'boolean') settings.hideExample = b.hideExample;
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      return send(res, 200, { filmsRoot: settings.filmsRoot });
    }
    return send(res, 404, { error: 'yok' });
  } catch (e) { return send(res, 500, { error: e.message }); }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Cinecode Studio http://localhost:${PORT}`));
