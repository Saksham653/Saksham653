// "A year on GitHub": a live tracker (followers, contributions, active days, longest streak, repos, stars) over a
// small city of the year, one block per day, as tall as that day's contributions. Numbers count up, the blocks rise,
// a light passes over the city and a beacon marks the busiest day. Writes assets/year-dark.svg and year-light.svg.
// Runs every morning from .github/workflows/year.yml; no dependencies.
//   GITHUB_TOKEN=... node scripts/year.mjs [saved-response.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const LOGIN = 'Saksham653';
const QUERY = `{ user(login: "${LOGIN}") {
  followers { totalCount }
  repositories(ownerAffiliations: OWNER, privacy: PUBLIC, first: 100) { totalCount nodes { stargazerCount isFork } }
  contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { contributionCount date weekday } } } } } }`;

async function load() {
  if (process.argv[2]) return JSON.parse(readFileSync(process.argv[2], 'utf8')).data.user;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'content-type': 'application/json', 'user-agent': 'profile-year' },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user;
}

const THEMES = {
  dark: { bg: '#0b0b0c', line: '#242427', ink: '#ededea', soft: '#9a9aa0', tile: '#121214', flat: '#19191c', lo: [62, 72, 128], hi: [126, 146, 255], accent: '#7389ff', win: '#ffe6a3', glow: '#e4e9ff' },
  light: { bg: '#f6f6f4', line: '#e2e2de', ink: '#111113', soft: '#5f5f66', tile: '#ffffff', flat: '#e6e6e1', lo: [205, 211, 238], hi: [43, 80, 255], accent: '#2b50ff', win: '#ffffff', glow: '#ffffff' },
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const W = 1200, H = 486;
const U = 19.2, V = [5.2, -6.6];        // one week to the right; one weekday further back (up and to the right)
const BW = 15.4, BD = 0.78;             // block width along a week, depth as a share of a weekday step
const X0 = 64, Y0 = 432, HMAX = 150;    // front-left corner of the first Sunday; the tallest block
const fmt = (n) => n.toLocaleString('en-US');
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c, k = 1) => `rgb(${c.map((v) => Math.round(v * k)).join(',')})`;
const pts = (list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const day = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// A number that counts up: eight passing frames, then the real value (which is also what shows without animation).
function countUp(x, y, value, start, cls, suffix = '') {
  const steps = 8, gap = 0.085;
  const frames = Array.from({ length: steps }, (_, k) => Math.round(value * (1 - (1 - k / steps) ** 3)));
  const passing = frames.map((v, k) => `<text class="${cls} fr" x="${x}" y="${y}" style="animation-delay:${(start + k * gap).toFixed(3)}s">${fmt(v)}${suffix}</text>`).join('');
  return passing + `<text class="${cls} fin" x="${x}" y="${y}" style="animation-duration:${(start + steps * gap).toFixed(3)}s">${fmt(value)}${suffix}</text>`;
}

function streaks(days) {
  let longest = 0, run = 0;
  for (const d of days) { run = d.contributionCount ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0;                                   // today may still be empty; count back from yesterday then
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount) current++;
    else if (i === days.length - 1) continue;
    else break;
  }
  return { longest, current };
}

// a small deterministic random, so a redraw only changes where the data changed
function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function summary(user) {
  const cal = user.contributionsCollection.contributionCalendar;
  const days = cal.weeks.flatMap((w, wk) => w.contributionDays.map((d) => ({ ...d, wk })));
  const busiest = days.reduce((a, d) => (d.contributionCount > a.contributionCount ? d : a));
  const active = days.filter((d) => d.contributionCount > 0).length;
  const stars = user.repositories.nodes.filter((r) => !r.isFork).reduce((s, r) => s + r.stargazerCount, 0);
  return { cal, days, busiest, active, stars, ...streaks(days), today: days[days.length - 1] };
}

function svg(user, t) {
  const { cal, days, busiest, active, stars, longest, current, today } = summary(user);
  const max = Math.max(1, ...days.map((d) => d.contributionCount));
  const WAVE = 10, wave = (d) => 2.6 + d.wk * 0.13 + d.weekday * 0.02;   // a ripple of light, day by day, every 10 s

  // the tracker: six tiles, each number counting up; two carry a small chart
  const tiles = [
    [user.followers.totalCount, 'followers'],
    [cal.totalContributions, 'contributions'],
    [active, 'active days'],
    current >= 2 ? [current, 'day streak now'] : [longest, 'day longest streak'],
    [user.repositories.totalCount, 'public repos'],
    [stars, 'stars earned'],
  ];
  const TW = (W - 2 * X0 - 5 * 12) / 6;
  const months = [];
  for (const d of days) { const m = d.date.slice(0, 7); if (months.at(-1)?.m !== m) months.push({ m, n: 0 }); months.at(-1).n += d.contributionCount; }
  const tileSvg = tiles.map(([v, label], i) => {
    const x = X0 + i * (TW + 12);
    let extra = '';
    if (i === 1) {                                           // contributions: the months as a line that draws itself
      const mx = Math.max(1, ...months.map((m) => m.n)), x1 = x + 106, x2 = x + TW - 14, y1 = 96, y2 = 134;
      const line = months.map((m, j) => `${j ? 'L' : 'M'}${(x1 + (x2 - x1) * j / (months.length - 1)).toFixed(1)},${(y2 - (y2 - y1) * m.n / mx).toFixed(1)}`).join('');
      extra = `<path class="draw" d="${line}" pathLength="1" fill="none" stroke="${t.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    if (i === 2) {                                           // active days: a ring filling to the share of the year
      const cx = x + TW - 34, share = active / days.length;
      extra = `<circle cx="${cx.toFixed(1)}" cy="114" r="17" fill="none" stroke="${t.line}" stroke-width="4"/>`
        + `<circle class="ring" cx="${cx.toFixed(1)}" cy="114" r="17" fill="none" stroke="${t.accent}" stroke-width="4" stroke-linecap="round" pathLength="1" transform="rotate(-90 ${cx.toFixed(1)} 114)" style="--to:${(1 - share).toFixed(3)}"/>`
        + `<text class="lbl" x="${cx.toFixed(1)}" y="118" text-anchor="middle" style="font-size:10.5px">${Math.round(share * 100)}%</text>`;
    }
    return `<g class="tile" style="animation-delay:${(0.08 * i).toFixed(2)}s"><rect x="${x.toFixed(1)}" y="78" width="${TW.toFixed(1)}" height="84" rx="12" fill="${t.tile}" stroke="${t.line}"/>`
      + countUp((x + 16).toFixed(1), 122, v, 0.25 + 0.08 * i, 'num') + extra
      + `<text class="lbl" x="${(x + 16).toFixed(1)}" y="146">${label}</text></g>`;
  }).join('');

  // the city: back rows first, then left to right, so nearer blocks cover the ones behind them
  const order = [...days].sort((a, b) => b.weekday - a.weekday || a.wk - b.wk);
  let beacon = '', marker = '';
  const blocks = order.map((d) => {
    const ox = X0 + d.wk * U + d.weekday * V[0], oy = Y0 + d.weekday * V[1];
    const A = [ox, oy], B = [ox + BW, oy], C = [ox + BW + V[0] * BD, oy + V[1] * BD], D = [ox + V[0] * BD, oy + V[1] * BD];
    const n = d.contributionCount, w = wave(d).toFixed(2);
    const h = n ? 5 + (HMAX - 5) * Math.log1p(n) / Math.log1p(max) : 0;
    const top = [A, B, C, D].map(([x, y]) => [x, y - h]);
    if (d === today) {
      const tx = (A[0] + C[0]) / 2, ty = (A[1] + C[1]) / 2 - h;
      marker = `<g class="beacon" style="animation-delay:2.4s"><circle class="ping" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="5" fill="${t.accent}"/>`
        + `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="3" fill="${t.accent}"/>`
        + `<text class="lbl" x="${(tx + 10).toFixed(1)}" y="${(ty - 8).toFixed(1)}" style="fill:${t.accent}">today</text></g>`;
    }
    if (!n) return `<polygon points="${pts(top)}" fill="${t.flat}"/><polygon class="glow0" style="animation-delay:${w}s" points="${pts(top)}" fill="${t.accent}"/>`;
    const k = Math.log1p(n) / Math.log1p(max), c = mix(t.lo, t.hi, Math.min(1, k * k * 1.25));
    const up = ([x, y]) => [x, y - h];
    if (d === busiest) {
      const bx = (A[0] + C[0]) / 2, by = (A[1] + C[1]) / 2 - h;
      beacon = `<g class="beacon"><line x1="${bx.toFixed(1)}" y1="${(by - 8).toFixed(1)}" x2="${bx.toFixed(1)}" y2="${(by - 34).toFixed(1)}" stroke="${t.accent}" stroke-width="1.5"/>`
        + `<circle class="ping" cx="${bx.toFixed(1)}" cy="${(by - 4).toFixed(1)}" r="6" fill="${t.accent}"/><circle cx="${bx.toFixed(1)}" cy="${(by - 4).toFixed(1)}" r="3.5" fill="${t.accent}"/>`
        + `<text class="lbl" x="${(bx - 6).toFixed(1)}" y="${(by - 42).toFixed(1)}" text-anchor="end"><tspan class="strong">${n}</tspan> on ${day(d.date)}, the busiest day</text></g>`;
    }
    // lit windows on the taller blocks, each twinkling at its own pace
    const rnd = seeded(d.date);
    let windows = '';
    if (h > 30) {
      for (let wy = A[1] - h + 7; wy < A[1] - 6; wy += 7) for (const wx of [A[0] + 3.4, A[0] + 9.4]) {
        if (rnd() >= 0.3) continue;
        const at = `x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="2.6" height="2.4" fill="${t.win}"`;
        windows += rnd() < 0.2   // about one in five twinkles; the rest stay lit, dimmer or brighter
          ? `<rect class="win" ${at} style="animation-duration:${(2.4 + rnd() * 3.6).toFixed(1)}s;animation-delay:${(rnd() * 4).toFixed(1)}s"/>`
          : `<rect ${at} opacity="${(0.25 + rnd() * 0.6).toFixed(2)}"/>`;
      }
    }
    return `<g class="b" style="animation-delay:${(0.6 + d.wk * 0.022).toFixed(3)}s"><g class="w" style="animation-delay:${w}s">`
      + `<polygon points="${pts([A, B, up(B), up(A)])}" fill="${rgb(c, 0.78)}"/>`
      + `<polygon points="${pts([B, C, up(C), up(B)])}" fill="${rgb(c, 0.6)}"/>`
      + `<polygon points="${pts(top)}" fill="${rgb(c)}"/>${windows}`
      + `<polygon class="glow" style="animation-delay:${w}s" points="${pts(top)}" fill="${t.glow}"/></g></g>`;
  }).join('');
  const labels = cal.weeks.map((w, wk) => {
    const first = w.contributionDays.find((d) => d.date.endsWith('-01'));
    return first && wk < cal.weeks.length - 1
      ? `<text class="lbl ml" x="${(X0 + wk * U).toFixed(1)}" y="${Y0 + 24}" style="animation-delay:${wave({ wk, weekday: 0 }).toFixed(2)}s">${MONTHS[+first.date.slice(5, 7) - 1]}</text>` : '';
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">A year on GitHub</title>
<desc id="d">${user.followers.totalCount} followers, ${fmt(cal.totalContributions)} contributions in the last year on ${active} days, longest streak ${longest} days, ${user.repositories.totalCount} public repositories, ${stars} stars. Busiest day ${day(busiest.date)} with ${busiest.contributionCount}. Updated ${day(today.date)}.</desc>
<defs><clipPath id="card"><rect width="${W}" height="${H}" rx="18"/></clipPath></defs>
<style>
  text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: ${t.soft}; }
  .k { font-size: 12.5px; letter-spacing: .16em; }
  .lbl { font-size: 12.5px; letter-spacing: .02em; }
  .strong { fill: ${t.ink}; font-weight: 600; }
  .go { fill: ${t.accent}; font-weight: 600; }
  .num { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; fill: ${t.ink}; font-size: 30px; font-weight: 650; letter-spacing: -.02em; }
  .fr { opacity: 0; animation: frame .085s linear; }
  @keyframes frame { from, to { opacity: 1; } }
  .fin { animation-name: wait; animation-timing-function: step-end; }
  @keyframes wait { from, to { opacity: 0; } }
  .tile { animation: lift .7s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes lift { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .draw { stroke-dasharray: 1; animation: draw 1.6s .6s cubic-bezier(.4,0,.2,1) both; }
  @keyframes draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
  .ring { stroke-dasharray: 1; stroke-dashoffset: var(--to); animation: ring 1.6s .7s cubic-bezier(.4,0,.2,1) both; }
  @keyframes ring { from { stroke-dashoffset: 1; } to { stroke-dashoffset: var(--to); } }
  .b { transform-box: fill-box; transform-origin: 50% 100%; animation: rise .9s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes rise { from { transform: scaleY(0); opacity: 0; } to { transform: scaleY(1); opacity: 1; } }
  .w { animation: bob ${WAVE}s ease-in-out infinite; }
  @keyframes bob { 0%, 6%, 100% { transform: none; } 2.4% { transform: translateY(-7px); } }
  .glow { opacity: 0; animation: glow ${WAVE}s linear infinite; }
  @keyframes glow { 0% { opacity: 0; } 1.4% { opacity: .9; } 7% { opacity: 0; } 100% { opacity: 0; } }
  .glow0 { opacity: 0; animation: glow0 ${WAVE}s linear infinite; }
  @keyframes glow0 { 0% { opacity: 0; } 1.4% { opacity: .45; } 7% { opacity: 0; } 100% { opacity: 0; } }
  .ml { animation: mflash ${WAVE}s linear infinite; }
  @keyframes mflash { 0%, 9%, 100% { fill: ${t.soft}; } 1.5% { fill: ${t.accent}; } }
  .win { opacity: .2; animation: twinkle 4s ease-in-out infinite; }
  @keyframes twinkle { 0%, 100% { opacity: .15; } 50% { opacity: 1; } }
  .beacon { animation: lift .6s 2.2s both; }
  .ping { transform-box: fill-box; transform-origin: center; animation: ping 2s 2.6s ease-out infinite; }
  @keyframes ping { 0% { opacity: .6; transform: scale(1); } 100% { opacity: 0; transform: scale(3.2); } }
  .live { animation: blink 2s ease-in-out infinite; }
  @keyframes blink { 50% { opacity: .25; } }
  @media (prefers-reduced-motion: reduce) { .fr, .fin, .tile, .draw, .ring, .b, .w, .glow, .glow0, .ml, .win, .beacon, .ping, .live { animation: none; } }
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="18" fill="${t.bg}" stroke="${t.line}"/>
<text class="k" x="${X0}" y="52">A YEAR ON GITHUB</text>
<circle class="live" cx="${W - X0 - 352}" cy="47.5" r="4" fill="${t.accent}"/>
<text class="lbl" x="${W - X0}" y="52" text-anchor="end">live · updated ${day(today.date)} · <tspan class="go">explore the year →</tspan></text>
${tileSvg}
<g clip-path="url(#card)">
${blocks}
</g>
${beacon}
${marker}
${labels}
</svg>
`;
}

// the same year as data, for the interactive page (saksham653.github.io/year/)
function json(user) {
  const { cal, days, busiest, active, stars, longest, current, today } = summary(user);
  return JSON.stringify({
    login: LOGIN, updated: today.date, followers: user.followers.totalCount, publicRepos: user.repositories.totalCount, stars,
    total: cal.totalContributions, active, longest, current, busiest: { date: busiest.date, count: busiest.contributionCount },
    days: days.map((d) => [d.date, d.contributionCount]),
  });
}

const user = await load();
mkdirSync('assets', { recursive: true });
for (const [name, t] of Object.entries(THEMES)) writeFileSync(`assets/year-${name}.svg`, svg(user, t));
writeFileSync('assets/year.json', json(user) + '\n');
const cal = user.contributionsCollection.contributionCalendar;
console.log(`year: ${user.followers.totalCount} followers, ${cal.totalContributions} contributions, ${cal.weeks.length} weeks`);
