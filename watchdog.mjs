const GIST_ID = must('GIST_ID');
const GIST_OWNER = must('GIST_OWNER');
const GIST_TOKEN = must('GIST_TOKEN');
const TG_TOKEN = must('TG_TOKEN');
const TG_CHAT = must('TG_CHAT');
const STALE_SECONDS = Number(process.env.STALE_SECONDS || 600);

function must(name) {
  if (!process.env[name]) {
    console.error(`missing env: ${name}`);
    process.exit(1);
  }
  return process.env[name];
}

async function tg(text) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text }),
  });
  if (!res.ok) {
    throw new Error(`telegram ${res.status}: ${await res.text()}`);
  }
}

async function writeGist(alerted) {
  const content = JSON.stringify({ ts: new Date().toISOString(), alerted });
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${GIST_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files: { 'heartbeat.txt': { content } } }),
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
console.log(`heartbeat age: ${Math.round(age)}s, alerted=${state.alerted}`);

if (age > STALE_SECONDS) {
  if (!state.alerted) {
    await tg(`🔴 discord-bot DOWN: нет heartbeat ${Math.round(age)} сек`);
    await writeGist(true);
    console.log('down alert sent');
  } else {
    console.log('already alerted, skipping');
  }
} else if (state.alerted) {
  await tg('🟢 discord-bot UP: снова в сети');
  await writeGist(false);
  console.log('recovery sent');
}
