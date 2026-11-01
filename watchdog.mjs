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

async function writeState(state) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${GIST_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files: { 'heartbeat.txt': { content: JSON.stringify(state) } } }),
  });
  if (!res.ok) {
    throw new Error(`gist ${res.status}: ${await res.text()}`);
  }
}

const rawUrl = `https://gist.githubusercontent.com/${GIST_OWNER}/${GIST_ID}/raw/heartbeat.txt?cb=${Date.now()}`;
const raw = await fetch(rawUrl).then((r) => {
  if (!r.ok) throw new Error(`gist raw ${r.status}`);
  return r.text();
});

let state;
try {
  state = JSON.parse(raw);
} catch {
  throw new Error(`bad gist content: ${raw}`);
}

const age = (Date.now() - new Date(state.ts).getTime()) / 1000;
if (!state.ts || Number.isNaN(age)) {
  throw new Error(`bad heartbeat ts: ${state.ts}`);
}
console.log(`heartbeat age: ${Math.round(age)}s, alerted=${state.alerted}, repeat=${REPEAT_SECONDS}s, chats=${CHATS.length}`);

if (age <= STALE_SECONDS) {
  console.log('heartbeat is fresh — silence means OK, no message');
  process.exit(0);
}

const now = Date.now();
const alertedAt = state.alerted_at ? new Date(state.alerted_at).getTime() : 0;
if (state.alerted && now - alertedAt < REPEAT_SECONDS * 1000) {
  console.log('already alerted, repeat not due yet');
  process.exit(0);
}

const ageStr = fmtAge(age) ?? `с ${new Date(state.ts).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Moscow',
})}`;
await tg(`🔴 discord-bot DOWN: нет heartbeat ${ageStr}`);
await writeState({ ...state, alerted: true, alerted_at: new Date(now).toISOString() });
console.log('down alert sent');
