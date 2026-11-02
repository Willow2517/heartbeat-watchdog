const GIST_ID = must('GIST_ID');
const GIST_OWNER = must('GIST_OWNER');
const GIST_TOKEN = must('GIST_TOKEN');
const TG_TOKEN = must('TG_TOKEN');
const CHATS = [process.env.TG_CHAT, process.env.TG_CHAT2].filter(Boolean);
if (CHATS.length === 0) {
  console.error('missing env: TG_CHAT');
  process.exit(1);
}
const STALE_SECONDS = Number(process.env.STALE_SECONDS || 600);
const REPEAT_SECONDS = Number(process.env.REPEAT_SECONDS || 1800);

function must(name) {
  if (!process.env[name]) {
    console.error(`missing env: ${name}`);
    process.exit(1);
  }
  return process.env[name];
}

function fmtAge(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 90) return `${sec} сек`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин`;
  const hours = Math.floor(min / 60);
  const restMin = min % 60;
  if (hours < 48) return restMin ? `${hours} ч ${restMin} мин` : `${hours} ч`;
  return null;
}

async function tg(text) {
  const results = await Promise.all(CHATS.map(async (chat) => {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    });
    return { chat, ok: res.ok, detail: res.ok ? '' : `${res.status}: ${await res.text()}` };
  }));
  for (const r of results) {
    if (r.ok) {
      console.log(`sent to chat ${r.chat}`);
    } else {
      console.error(`failed for chat ${r.chat}: ${r.detail}`);
    }
  }
  if (!results.some((r) => r.ok)) {
    throw new Error('telegram: all sends failed');
  }
}

async function readFile(file) {
  const res = await fetch(`https://gist.githubusercontent.com/${GIST_OWNER}/${GIST_ID}/raw/${file}?cb=${Date.now()}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`gist raw ${file} ${res.status}`);
  return res.text();
}

async function writeAlert(alerted, alerted_at) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${GIST_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files: { 'alert.txt': { content: JSON.stringify({ alerted, alerted_at }) } } }),
  });
  if (!res.ok) {
    throw new Error(`gist ${res.status}: ${await res.text()}`);
  }
}

const hbRaw = await readFile('heartbeat.txt');
if (!hbRaw) throw new Error('heartbeat.txt is missing');
const hb = JSON.parse(hbRaw);
const alRaw = await readFile('alert.txt');
const al = alRaw ? JSON.parse(alRaw) : { alerted: false, alerted_at: null };

const age = (Date.now() - new Date(hb.ts).getTime()) / 1000;
if (!hb.ts || Number.isNaN(age)) {
  throw new Error(`bad heartbeat ts: ${hb.ts}`);
}
console.log(`heartbeat age: ${Math.round(age)}s, alerted=${al.alerted}, repeat=${REPEAT_SECONDS}s, chats=${CHATS.length}`);

if (age <= STALE_SECONDS) {
  if (al.alerted) {
    await tg('🟢 discord-bot UP: снова в сети');
    await writeAlert(false, null);
    console.log('recovery sent');
  } else {
    console.log('heartbeat is fresh — silence means OK');
  }
  process.exit(0);
}

const now = Date.now();
const alertedAt = al.alerted_at ? new Date(al.alerted_at).getTime() : 0;
if (al.alerted && now - alertedAt < REPEAT_SECONDS * 1000) {
  console.log('already alerted, repeat not due yet');
  process.exit(0);
}

const ageStr = fmtAge(age) ?? `с ${new Date(hb.ts).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Moscow',
})}`;
await tg(`🔴 discord-bot DOWN: нет heartbeat ${ageStr}`);
await writeAlert(true, new Date(now).toISOString());
console.log('down alert sent');
