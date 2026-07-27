// ============================================================
// CCNP DCCOR Practice — квіз-рушій
// Дані: questions/manifest.json + questions/NNNN.json (кожне
// питання — окремий файл, зручно редагувати/додавати пізніше).
// ============================================================

const LETTERS = ['A','B','C','D','E','F'];
const STORAGE_PREFIX = 'dccor-quiz-progress-v3-';
const OLD_STORAGE_KEY_V1 = 'dccor-quiz-progress-v1';          // дуже стара версія (без режимів)
const TOPIC_FILTER_KEY = 'dccor-topic-filter-v1';

const TOPIC_ORDER = ['All', 'Network', 'Compute', 'Storage Network', 'Automation and AI', 'Security'];
const TOPIC_LABELS = {
  'All': 'Усі теми',
  'Network': 'Мережа (Network)',
  'Compute': 'Обчислення (Compute)',
  'Storage Network': 'Мережа зберігання (Storage Network)',
  'Automation and AI': 'Автоматизація та AI',
  'Security': 'Безпека (Security)'
};

let QUESTIONS = [];         // масив усіх 526 питань у порядку id
let activeIndices = [];     // індекси QUESTIONS, що входять у поточний фільтр теми
let current = 0;            // позиція всередині activeIndices
let answers = [];           // 'correct' | 'incorrect' | null, паралельно activeIndices
let userAnswerData = [];    // збережений вибір користувача (для перегляду), паралельно activeIndices
let score = 0;
let answeredCount = 0;
let started = false;
let mode = null;            // 'training' | 'exam'
let examRevealed = false;   // true, коли екзамен завершено і можна показувати правильні відповіді
let topicFilter = 'All';    // фільтр теми, застосовується ЛИШЕ до режиму «Тренування»
let sessionTopic = 'All';   // тема поточної сесії (для Екзамену завжди 'All')
let navChunk = 0;           // яка сотня питань зараз показана в навігації
let currentUser = null;     // slug поточного залогіненого користувача

const root = document.getElementById('app-root');

async function loadQuestions() {
  const manifestRes = await fetch('questions/manifest.json');
  const manifest = await manifestRes.json();
  const items = manifest.items.sort((a,b) => a.id - b.id);
  const all = await Promise.all(items.map(it => fetch('questions/' + it.file).then(r => r.json())));
  return all;
}

function indicesForTopic(topic) {
  if (topic === 'All') return QUESTIONS.map((_, i) => i);
  const res = [];
  QUESTIONS.forEach((q, i) => { if (q.topic === topic) res.push(i); });
  return res;
}

function topicCounts() {
  const counts = {};
  QUESTIONS.forEach(q => { counts[q.topic] = (counts[q.topic] || 0) + 1; });
  return counts;
}

function topicSlug(t) {
  return t === 'All' ? 'all' : t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function storageKeyFor(m, topic) {
  const userPart = currentUser ? currentUser + '-' : '';
  return STORAGE_PREFIX + userPart + (m === 'exam' ? 'exam' : 'training') + '-' + topicSlug(topic);
}

function migrateOldProgress() {
  try {
    // v1 (найстаріша, один загальний прогрес без режимів) -> training/Усі теми
    const v1 = localStorage.getItem(OLD_STORAGE_KEY_V1);
    const trainingAllKey = storageKeyFor('training', 'All');
    if (v1 && !localStorage.getItem(trainingAllKey)) {
      const d = JSON.parse(v1);
      if (d.answers && d.answers.length === QUESTIONS.length) {
        localStorage.setItem(trainingAllKey, JSON.stringify({ ...d, examRevealed: false }));
      }
    }
    // v2 (розділення на training/exam, без фільтра тем) -> v3 training|exam / Усі теми
    ['training', 'exam'].forEach(m => {
      const v2Key = 'dccor-quiz-progress-v2-' + m;
      const v3Key = storageKeyFor(m, 'All');
      const v2 = localStorage.getItem(v2Key);
      if (v2 && !localStorage.getItem(v3Key)) {
        const d = JSON.parse(v2);
        if (d.answers && d.answers.length === QUESTIONS.length) {
          localStorage.setItem(v3Key, v2);
        }
      }
    });
  } catch (e) {}
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(storageKeyFor(mode, sessionTopic));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function saveProgress() {
  try {
    localStorage.setItem(storageKeyFor(mode, sessionTopic), JSON.stringify({
      answers, userAnswerData, current, score, answeredCount, examRevealed
    }));
  } catch (e) {}
}

function resetProgress() {
  answers = new Array(activeIndices.length).fill(null);
  userAnswerData = new Array(activeIndices.length).fill(null);
  current = 0; score = 0; answeredCount = 0; examRevealed = false;
  saveProgress();
}

function peekStats(m, topic) {
  const total = indicesForTopic(topic).length;
  try {
    const raw = localStorage.getItem(storageKeyFor(m, topic));
    if (!raw) return { answeredN: 0, score: 0, total, examRevealed: false };
    const d = JSON.parse(raw);
    if (!d.answers || d.answers.length !== total) return { answeredN: 0, score: 0, total, examRevealed: false };
    return { answeredN: d.answers.filter(a => a !== null).length, score: d.score || 0, total, examRevealed: !!d.examRevealed };
  } catch (e) { return { answeredN: 0, score: 0, total, examRevealed: false }; }
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------
// LANDING / ВИБІР РЕЖИМУ + ФІЛЬТРА ТЕМИ
// ------------------------------------------------------------
function selectMode(m) {
  mode = m;
  // фільтр теми стосується лише тренування; екзамен завжди охоплює всі 526 питань
  sessionTopic = (m === 'exam') ? 'All' : topicFilter;
  activeIndices = indicesForTopic(sessionTopic);
  navChunk = 0;
  const saved = loadProgress();
  if (saved && saved.answers && saved.answers.length === activeIndices.length) {
    answers = saved.answers;
    userAnswerData = saved.userAnswerData || new Array(activeIndices.length).fill(null);
    current = Math.min(saved.current || 0, Math.max(activeIndices.length - 1, 0));
    score = saved.score || 0;
    answeredCount = saved.answeredCount || 0;
    examRevealed = !!saved.examRevealed;
  } else {
    resetProgress();
  }
  started = true;
  render();
}

function goHome() {
  started = false;
  mode = null;
  render();
}

function renderLanding() {
  // на головній завжди показуємо загальний прогрес по всіх темах;
  // звуження за темою відбувається під час самого тренування (селектор над питанням).
  const t = peekStats('training', 'All');
  const e = peekStats('exam', 'All');

  const userObj = AUTH_USERS.find(u => u.slug === currentUser);
  const userBar = userObj ? `<div class="user-bar">Увійшов як: <strong>${escapeHtml(userObj.name)}</strong> · <a href="#" id="logout-link">Вийти</a></div>` : '';

  root.innerHTML = `
    <div class="landing">
      ${userBar}
      <h1>CCNP DCCOR — тренажер</h1>
      <p>350-601 DCCOR практичні питання з поясненнями. Прогрес зберігається у браузері окремо для кожного користувача й режиму. Фільтр за темою (Network, Compute, ...) доступний прямо над питаннями в режимі «Тренування».</p>
      <div class="mode-cards">
        <div class="mode-card">
          <h3>Тренування</h3>
          <p class="mode-desc">Правильна відповідь і пояснення показуються одразу після кожного питання.</p>
          <div class="mode-stat">${t.answeredN} / ${t.total} пройдено · ${t.score} правильно</div>
          <div class="landing-actions">
            <button class="btn" id="start-training">${t.answeredN > 0 ? 'Продовжити' : 'Почати'}</button>
            ${t.answeredN > 0 ? '<button class="btn secondary" id="restart-training">Скинути</button>' : ''}
          </div>
        </div>
        <div class="mode-card">
          <h3>Екзамен</h3>
          <p class="mode-desc">Без підказок під час проходження. Правильні відповіді й пояснення — лише у підсумку. Завжди всі теми.</p>
          <div class="mode-stat">${e.answeredN > 0 ? (e.examRevealed ? `${e.answeredN} / ${e.total} · ${e.score} правильно` : `${e.answeredN} / ${e.total} · в процесі`) : `0 / ${e.total}`}</div>
          <div class="landing-actions">
            <button class="btn" id="start-exam">${e.answeredN > 0 ? 'Продовжити' : 'Почати'}</button>
            ${e.answeredN > 0 ? '<button class="btn secondary" id="restart-exam">Скинути</button>' : ''}
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('topbar').classList.add('hidden');

  const logoutLink = document.getElementById('logout-link');
  if (logoutLink) logoutLink.onclick = (e) => { e.preventDefault(); logout(); };

  document.getElementById('start-training').onclick = () => { topicFilter = 'All'; selectMode('training'); };
  document.getElementById('start-exam').onclick = () => selectMode('exam');
  const rt = document.getElementById('restart-training');
  if (rt) rt.onclick = () => {
    if (confirm('Скинути прогрес режиму «Тренування» (усі теми)?')) {
      localStorage.removeItem(storageKeyFor('training', 'All')); renderLanding();
    }
  };
  const re = document.getElementById('restart-exam');
  if (re) re.onclick = () => {
    if (confirm('Скинути прогрес режиму «Екзамен»?')) {
      localStorage.removeItem(storageKeyFor('exam', 'All')); renderLanding();
    }
  };
}

// ------------------------------------------------------------
// TOPBAR
// ------------------------------------------------------------
function updateTopbar() {
  document.getElementById('topbar').classList.remove('hidden');
  document.getElementById('q-counter').textContent = `Питання ${current + 1} / ${activeIndices.length}`;
  document.getElementById('progress-bar').style.width = `${(current / activeIndices.length) * 100}%`;
  const statsEl = document.getElementById('stats');
  if (mode === 'exam' && !examRevealed) {
    statsEl.textContent = `Відповідано: ${answeredCount} / ${activeIndices.length}`;
  } else {
    statsEl.textContent = `Правильно: ${score} / ${answeredCount}`;
  }
}

// ------------------------------------------------------------
// NAV DOTS
// ------------------------------------------------------------
const NAV_CHUNK_SIZE = 100;

// Показуємо лише одну «сотню» дотів за раз; перемикання — вкладками зверху.
// resync=true (за замовчуванням) підлаштовує видиму сотню під поточне питання
// (виклик з render()); resync=false зберігає вибір вкладки (виклик із самої вкладки).
function renderNavDots(container, resync) {
  if (resync === undefined) resync = true;
  container.innerHTML = '';
  const reveal = mode !== 'exam' || examRevealed;
  const totalChunks = Math.max(1, Math.ceil(activeIndices.length / NAV_CHUNK_SIZE));

  if (resync) navChunk = Math.floor(current / NAV_CHUNK_SIZE);
  if (navChunk >= totalChunks) navChunk = totalChunks - 1;
  if (navChunk < 0) navChunk = 0;

  if (totalChunks > 1) {
    const tabs = document.createElement('div');
    tabs.className = 'nav-chunk-tabs';
    for (let c = 0; c < totalChunks; c++) {
      const cStart = c * NAV_CHUNK_SIZE + 1;
      const cEnd = Math.min((c + 1) * NAV_CHUNK_SIZE, activeIndices.length);
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'nav-chunk-tab' + (c === navChunk ? ' active' : '');
      tab.textContent = `${cStart}–${cEnd}`;
      tab.onclick = () => { navChunk = c; renderNavDots(container, false); };
      tabs.appendChild(tab);
    }
    container.appendChild(tabs);
  }

  const start = navChunk * NAV_CHUNK_SIZE;
  const end = Math.min(start + NAV_CHUNK_SIZE, activeIndices.length);
  const grid = document.createElement('div');
  grid.className = 'nav-dots';
  for (let i = start; i < end; i++) {
    const qi = activeIndices[i];
    const d = document.createElement('div');
    d.className = 'dot';
    if (i === current) d.classList.add('current');
    if (reveal) {
      if (answers[i] === 'correct') d.classList.add('answered-correct');
      if (answers[i] === 'incorrect') d.classList.add('answered-incorrect');
    } else if (answers[i] !== null) {
      d.classList.add('answered-neutral');
    }
    d.title = 'Питання #' + QUESTIONS[qi].id;
    d.textContent = i + 1;
    d.onclick = () => { current = i; render(); };
    grid.appendChild(d);
  }
  container.appendChild(grid);
}

// ------------------------------------------------------------
// ФІЛЬТР ТЕМИ НАД ПИТАННЯМ (лише режим «Тренування»)
// ------------------------------------------------------------
function buildSessionTopicFilter() {
  const counts = topicCounts();
  const options = TOPIC_ORDER.map(topic => {
    const n = topic === 'All' ? QUESTIONS.length : (counts[topic] || 0);
    const label = TOPIC_LABELS[topic] || topic;
    const sel = topic === topicFilter ? ' selected' : '';
    return `<option value="${escapeHtml(topic)}"${sel}>${escapeHtml(label)} (${n})</option>`;
  }).join('');

  const bar = document.createElement('div');
  bar.className = 'session-topic-filter';
  bar.innerHTML = `<label for="session-topic-select">Тема:</label><select id="session-topic-select">${options}</select>`;

  const sel = bar.querySelector('select');
  sel.onchange = () => {
    if (sel.value === topicFilter) return;
    topicFilter = sel.value;
    try { localStorage.setItem(TOPIC_FILTER_KEY, topicFilter); } catch (e) {}
    selectMode('training'); // перезавантажує activeIndices + збережений прогрес під нову тему
  };
  return bar;
}

// ------------------------------------------------------------
// MAIN RENDER DISPATCH
// ------------------------------------------------------------
function render() {
  if (!started) { renderLanding(); return; }

  if (current >= activeIndices.length) { renderSummary(); return; }

  updateTopbar();

  const q = QUESTIONS[activeIndices[current]];
  const card = document.createElement('div');
  card.className = 'card';

  const modeLabel = mode === 'exam' ? 'Екзамен' : 'Тренування';
  const topicSuffix = sessionTopic !== 'All' ? ` · ${TOPIC_LABELS[sessionTopic] || sessionTopic}` : '';
  const modeTag = `<span class="mode-tag">${modeLabel}${topicSuffix}</span>`;
  const header = document.createElement('div');
  header.className = 'card-header';
  header.innerHTML = `<span>Питання #${q.id}${q.type === 'order' ? ' · впорядкування' : ''}${q.type === 'match' ? ' · зіставлення' : ''}${q.type === 'fill' ? ' · заповнення' : ''}</span>` +
    `<span>${q.needsAnswer ? '<span class="badge-warn">не підтверджено офіційно</span>' : ''} ${modeTag} ${escapeHtml(q.topic||'')}</span>`;
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = `<div class="q-text">${escapeHtml(q.question)}</div>`;
  if (q.context) {
    body.innerHTML += `<pre class="context">${escapeHtml(q.context)}</pre>`;
  }
  if (q.hasImage && q.image) {
    body.innerHTML += `<img class="q-image" src="${q.image}" alt="ілюстрація до питання">`;
  } else if (q.hasImage && q.imageNote) {
    body.innerHTML += `<div class="explanation">🖼 ${escapeHtml(q.imageNote)}</div>`;
  }

  card.appendChild(body);

  if (q.type === 'single' || q.type === 'multi') renderChoice(q, body);
  else if (q.type === 'order') renderOrder(q, body);
  else if (q.type === 'fill') renderFill(q, body);
  else if (q.type === 'match') renderMatch(q, body);

  const feedback = document.createElement('div');
  feedback.id = 'feedback';
  feedback.className = 'feedback';
  body.appendChild(feedback);

  const extra = document.createElement('div');
  extra.id = 'extra-info';
  body.appendChild(extra);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const checkBtn = document.createElement('button');
  checkBtn.className = 'btn';
  checkBtn.id = 'check-btn';
  checkBtn.textContent = mode === 'exam' ? 'Відповісти' : 'Перевірити';
  actions.appendChild(checkBtn);

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn secondary';
  prevBtn.textContent = '← Назад';
  prevBtn.disabled = current === 0;
  prevBtn.onclick = () => { current--; render(); };
  actions.appendChild(prevBtn);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn secondary';
  nextBtn.textContent = current === activeIndices.length - 1 ? 'Підсумок →' : 'Далі →';
  nextBtn.onclick = () => { current++; render(); };
  actions.appendChild(nextBtn);

  const homeBtn = document.createElement('button');
  homeBtn.className = 'btn secondary';
  homeBtn.textContent = 'На головну';
  homeBtn.onclick = () => goHome();
  actions.appendChild(homeBtn);

  root.innerHTML = '';

  if (mode === 'training') {
    root.appendChild(buildSessionTopicFilter());
  }

  root.appendChild(card);
  card.appendChild(actions);

  const navWrap = document.createElement('div');
  navWrap.className = 'nav-dots-wrap';
  root.appendChild(navWrap);
  renderNavDots(navWrap);

  // якщо вже відповідали раніше — одразу показати результат
  if (answers[current] !== null) {
    showAlreadyAnswered(q);
    checkBtn.disabled = true;
  } else {
    checkBtn.onclick = () => handleCheck(q);
  }
}

function showExtras(q) {
  const extra = document.getElementById('extra-info');
  let html = '';
  if (q.explanation) {
    html += `<div class="explanation"><strong>Пояснення:</strong>\n${escapeHtml(q.explanation)}</div>`;
  }
  if (q.reference) {
    html += `<div class="reference">Джерело: <a href="${escapeHtml(q.reference)}" target="_blank" rel="noopener">${escapeHtml(q.reference)}</a></div>`;
  }
  if (q.voteNote) {
    html += `<div class="vote-note">Голосування спільноти: ${escapeHtml(q.voteNote)}</div>`;
  }
  if (q.needsAnswer) {
    html += `<div class="feedback warn show">Офіційна відповідь у джерелі не була розкрита. Показана відповідь — найбільш імовірна (за голосами спільноти / логікою), перевіряється додатково.</div>`;
  }
  extra.innerHTML = html;
}

// ------------------------------------------------------------
// SINGLE / MULTI
// ------------------------------------------------------------
function renderChoice(q, body) {
  const wrap = document.createElement('div');
  wrap.className = 'options' + (q.type === 'multi' ? ' multi' : '');
  wrap.id = 'choice-wrap';
  q.options.forEach((opt, i) => {
    const el = document.createElement('div');
    el.className = 'option';
    el.dataset.idx = i;
    el.innerHTML = `<div class="marker">${LETTERS[i]}</div><div>${escapeHtml(opt)}</div>`;
    el.onclick = () => {
      if (answers[current] !== null) return;
      if (q.type === 'single') {
        wrap.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
      } else {
        el.classList.toggle('selected');
      }
    };
    wrap.appendChild(el);
  });
  body.appendChild(wrap);
}

function checkChoice(q) {
  const wrap = document.getElementById('choice-wrap');
  const selected = [...wrap.querySelectorAll('.option.selected')].map(o => parseInt(o.dataset.idx, 10));
  return selected;
}

function markChoice(q, selected, reveal) {
  const wrap = document.getElementById('choice-wrap');
  const correctSet = new Set(q.correct);
  const selSet = new Set(selected);
  [...wrap.children].forEach((el, i) => {
    el.style.cursor = 'default';
    if (reveal) {
      if (correctSet.has(i)) el.classList.add('correct');
      else if (selSet.has(i)) el.classList.add('incorrect');
    }
  });
}

// ------------------------------------------------------------
// ORDER
// ------------------------------------------------------------
let orderState = {};
function renderOrder(q, body) {
  if (!(current in orderState)) {
    let shuffled;
    const idxArr = q.items.map((_, i) => i);
    do { shuffled = shuffle(idxArr); } while (JSON.stringify(shuffled) === JSON.stringify(q.correctOrder));
    orderState[current] = shuffled;
  }
  const list = document.createElement('div');
  list.className = 'order-list';
  list.id = 'order-list';
  body.appendChild(list);
  drawOrderList(q, list);
}

function drawOrderList(q, list) {
  list.innerHTML = '';
  const order = orderState[current];
  order.forEach((itemIdx, pos) => {
    const row = document.createElement('div');
    row.className = 'order-item';
    row.dataset.itemIdx = itemIdx;
    row.innerHTML = `
      <div class="step-badge">${pos + 1}</div>
      <div class="item-text">${escapeHtml(q.items[itemIdx])}</div>
      <div class="arrows">
        <button data-dir="up" ${pos === 0 ? 'disabled' : ''}>↑</button>
        <button data-dir="down" ${pos === order.length - 1 ? 'disabled' : ''}>↓</button>
      </div>`;
    const [upBtn, downBtn] = row.querySelectorAll('button');
    upBtn.onclick = () => { if (answers[current] === null) { moveOrderItem(pos, -1); drawOrderList(q, list); } };
    downBtn.onclick = () => { if (answers[current] === null) { moveOrderItem(pos, 1); drawOrderList(q, list); } };
    list.appendChild(row);
  });
}

function moveOrderItem(pos, dir) {
  const order = orderState[current];
  const newPos = pos + dir;
  if (newPos < 0 || newPos >= order.length) return;
  [order[pos], order[newPos]] = [order[newPos], order[pos]];
}

function markOrder(q, reveal) {
  const order = orderState[current];
  const rows = document.querySelectorAll('#order-list .order-item');
  rows.forEach((row, pos) => {
    row.querySelectorAll('button').forEach(b => b.disabled = true);
    if (!reveal) return;
    const itemIdx = parseInt(row.dataset.itemIdx, 10);
    if (q.correctOrder[pos] === itemIdx) row.classList.add('correct');
    else row.classList.add('incorrect');
  });
}

// ------------------------------------------------------------
// FILL (заповнення пропусків)
// ------------------------------------------------------------
function renderFill(q, body) {
  const pre = document.createElement('div');
  pre.className = 'fill-template';
  pre.id = 'fill-template';
  body.appendChild(pre);
  drawFillTemplate(q, pre);
}

function drawFillTemplate(q, pre) {
  const parts = q.template.split(/(\{\{\d+\}\})/g);
  const uniqueBank = [...new Set(q.wordBank)];
  let html = '';
  parts.forEach(part => {
    const m = part.match(/^\{\{(\d+)\}\}$/);
    if (m) {
      const blankIdx = parseInt(m[1], 10) - 1;
      html += `<select class="fill-blank" data-blank="${blankIdx}"><option value="">— обрати —</option>`;
      uniqueBank.forEach(w => {
        html += `<option value="${escapeHtml(w)}">${escapeHtml(w)}</option>`;
      });
      html += `</select>`;
    } else {
      html += escapeHtml(part);
    }
  });
  pre.innerHTML = html;
}

function markFill(q, reveal) {
  const selects = document.querySelectorAll('#fill-template select.fill-blank');
  selects.forEach(sel => {
    sel.disabled = true;
    if (!reveal) return;
    const idx = parseInt(sel.dataset.blank, 10);
    const correctVal = q.blankAnswers[idx];
    if (sel.value === correctVal) sel.classList.add('correct');
    else sel.classList.add('incorrect');
  });
}

function isFillCorrect(q) {
  const selects = document.querySelectorAll('#fill-template select.fill-blank');
  let ok = true;
  selects.forEach(sel => {
    const idx = parseInt(sel.dataset.blank, 10);
    if (sel.value !== q.blankAnswers[idx]) ok = false;
  });
  return ok;
}

function getFillAnswers() {
  const selects = document.querySelectorAll('#fill-template select.fill-blank');
  const res = [];
  selects.forEach(sel => { res[parseInt(sel.dataset.blank,10)] = sel.value; });
  return res;
}

function restoreFillAnswers(vals) {
  const selects = document.querySelectorAll('#fill-template select.fill-blank');
  selects.forEach(sel => {
    const idx = parseInt(sel.dataset.blank, 10);
    if (vals && vals[idx] !== undefined) sel.value = vals[idx];
  });
}

// ------------------------------------------------------------
// MATCH (зіставлення)
// ------------------------------------------------------------
function renderMatch(q, body) {
  const list = document.createElement('div');
  list.className = 'match-list';
  list.id = 'match-list';
  q.bank.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'match-item';
    row.dataset.idx = i;
    let opts = `<option value="">— не використовується —</option>`;
    q.targets.forEach((t, ti) => { opts += `<option value="${ti}">${escapeHtml(t)}</option>`; });
    row.innerHTML = `<div class="bank-text">${escapeHtml(item)}</div><select data-idx="${i}">${opts}</select>`;
    list.appendChild(row);
  });
  body.appendChild(list);
}

function markMatch(q, reveal) {
  const rows = document.querySelectorAll('#match-list .match-item');
  rows.forEach(row => {
    const sel = row.querySelector('select');
    sel.disabled = true;
    if (!reveal) return;
    const i = parseInt(row.dataset.idx, 10);
    const chosen = sel.value === '' ? null : parseInt(sel.value, 10);
    const correct = q.matchCorrect[i];
    if (chosen === correct) row.classList.add('correct');
    else row.classList.add('incorrect');
  });
}

function isMatchCorrect(q) {
  const rows = document.querySelectorAll('#match-list .match-item');
  let ok = true;
  rows.forEach(row => {
    const i = parseInt(row.dataset.idx, 10);
    const sel = row.querySelector('select');
    const chosen = sel.value === '' ? null : parseInt(sel.value, 10);
    if (chosen !== q.matchCorrect[i]) ok = false;
  });
  return ok;
}

function getMatchAnswers() {
  const rows = document.querySelectorAll('#match-list .match-item');
  const res = [];
  rows.forEach(row => {
    const i = parseInt(row.dataset.idx, 10);
    const sel = row.querySelector('select');
    res[i] = sel.value === '' ? null : parseInt(sel.value, 10);
  });
  return res;
}

function restoreMatchAnswers(vals) {
  const rows = document.querySelectorAll('#match-list .match-item');
  rows.forEach(row => {
    const i = parseInt(row.dataset.idx, 10);
    const sel = row.querySelector('select');
    if (vals && vals[i] !== undefined && vals[i] !== null) sel.value = String(vals[i]);
  });
}

// ------------------------------------------------------------
// CHECK HANDLER
// ------------------------------------------------------------
function handleCheck(q) {
  let isCorrect = false;
  let userData = null;
  const reveal = mode !== 'exam';

  if (q.type === 'single' || q.type === 'multi') {
    const selected = checkChoice(q);
    if (selected.length === 0) { alert('Обери відповідь.'); return; }
    userData = selected;
    const correctSet = new Set(q.correct);
    const selSet = new Set(selected);
    isCorrect = correctSet.size === selSet.size && [...correctSet].every(x => selSet.has(x));
    markChoice(q, selected, reveal);
  } else if (q.type === 'order') {
    userData = orderState[current].slice();
    isCorrect = JSON.stringify(orderState[current]) === JSON.stringify(q.correctOrder);
    markOrder(q, reveal);
  } else if (q.type === 'fill') {
    const vals = getFillAnswers();
    if (vals.some(v => !v)) { alert('Заповни всі поля.'); return; }
    userData = vals;
    isCorrect = isFillCorrect(q);
    markFill(q, reveal);
  } else if (q.type === 'match') {
    const vals = getMatchAnswers();
    userData = vals;
    isCorrect = isMatchCorrect(q);
    markMatch(q, reveal);
  }

  answers[current] = isCorrect ? 'correct' : 'incorrect';
  userAnswerData[current] = userData;
  answeredCount++;
  if (isCorrect) score++;

  const feedback = document.getElementById('feedback');
  if (reveal) {
    feedback.classList.add('show', isCorrect ? 'correct' : 'incorrect');
    feedback.textContent = isCorrect ? '✓ Правильно!' : '✗ Неправильно.';
    showExtras(q);
  } else {
    feedback.classList.add('show', 'neutral');
    feedback.textContent = 'Відповідь зафіксована.';
  }

  updateTopbar();
  document.getElementById('check-btn').disabled = true;
  saveProgress();

  // оновити навдоти
  const navWrap = document.querySelector('.nav-dots');
  if (navWrap) renderNavDots(navWrap);
}

function showAlreadyAnswered(q) {
  const reveal = mode !== 'exam' || examRevealed;
  const isCorrect = answers[current] === 'correct';
  const feedback = document.getElementById('feedback');
  if (reveal) {
    feedback.classList.add('show', isCorrect ? 'correct' : 'incorrect');
    feedback.textContent = isCorrect ? '✓ Правильно!' : '✗ Неправильно.';
  } else {
    feedback.classList.add('show', 'neutral');
    feedback.textContent = 'Відповідь зафіксована.';
  }

  if (q.type === 'single' || q.type === 'multi') {
    const wrap = document.getElementById('choice-wrap');
    (userAnswerData[current] || []).forEach(i => wrap.children[i] && wrap.children[i].classList.add('selected'));
    markChoice(q, userAnswerData[current] || [], reveal);
  } else if (q.type === 'order') {
    orderState[current] = userAnswerData[current] ? userAnswerData[current].slice() : orderState[current];
    drawOrderList(q, document.getElementById('order-list'));
    markOrder(q, reveal);
  } else if (q.type === 'fill') {
    restoreFillAnswers(userAnswerData[current]);
    markFill(q, reveal);
  } else if (q.type === 'match') {
    restoreMatchAnswers(userAnswerData[current]);
    markMatch(q, reveal);
  }

  if (reveal) showExtras(q);
  else document.getElementById('extra-info').innerHTML = '';
}

// ------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------
function renderSummary() {
  if (mode === 'exam' && !examRevealed) {
    examRevealed = true;
    saveProgress();
  }

  document.getElementById('topbar').classList.remove('hidden');
  document.getElementById('q-counter').textContent = 'Підсумок';
  document.getElementById('progress-bar').style.width = '100%';
  document.getElementById('stats').textContent = `Правильно: ${score} / ${answeredCount}`;

  const pct = activeIndices.length ? Math.round((score / activeIndices.length) * 100) : 0;
  const wrongIds = activeIndices.filter((qi, i) => answers[i] === 'incorrect').map(qi => QUESTIONS[qi].id);

  const modeLabel = mode === 'exam' ? 'Екзамен' : 'Тренування';
  const topicSuffix = sessionTopic !== 'All' ? ` · ${TOPIC_LABELS[sessionTopic] || sessionTopic}` : '';

  root.innerHTML = `
    <div class="card">
      <div class="card-header"><span>Результат — ${modeLabel}${topicSuffix}</span></div>
      <div class="card-body summary">
        <h2>Тест завершено</h2>
        <div class="score">${score} / ${activeIndices.length}</div>
        <div>${pct}% правильних відповідей</div>
        ${wrongIds.length ? `<div style="margin-top:10px; color:var(--muted); font-size:13px;">Помилки у питаннях: ${wrongIds.join(', ')}</div>` : ''}
        <div class="actions" style="justify-content:center; margin:20px 0 0;">
          <button class="btn" id="restart-btn">Пройти заново</button>
          <button class="btn secondary" id="review-btn">Переглянути помилки</button>
          <button class="btn secondary" id="home-btn">На головну</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('restart-btn').onclick = () => {
    if (confirm('Скинути прогрес і почати заново?')) { resetProgress(); render(); }
  };
  document.getElementById('review-btn').onclick = () => {
    const firstWrong = answers.findIndex(a => a === 'incorrect');
    if (firstWrong === -1) { alert('Помилок немає 🎉'); return; }
    current = firstWrong;
    render();
  };
  document.getElementById('home-btn').onclick = () => goHome();
}

// ------------------------------------------------------------
// ДОСТУП ЗА ПАРОЛЕМ (клієнтський гейт для GitHub Pages, декілька користувачів)
// ------------------------------------------------------------
const AUTH_USERS = [
  { slug: 'vasiliy', name: 'Vasiliy Fisunov', hash: '7bac617a5a8424c0044a2533b1ef18a6c2129b41604bb3da853e168547c4c3f4' },
  { slug: 'oleksii', name: 'Oleksii Zamsha', hash: 'f33b93badd759a935f4bf584af63a8aa39d834855ad1b22ebc4c4e05de6f7607' }
];
const AUTH_KEY = 'dccor-auth-user-v2';

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function checkAuth() {
  const savedSlug = sessionStorage.getItem(AUTH_KEY);
  const user = AUTH_USERS.find(u => u.slug === savedSlug);
  if (user) { currentUser = user.slug; showApp(); return; }
  showGate();
}

function showGate() {
  document.getElementById('auth-gate').classList.remove('hidden');
  document.getElementById('topbar').classList.add('hidden');
  document.querySelector('.wrap').classList.add('hidden');
  const btn = document.getElementById('auth-btn');
  const input = document.getElementById('auth-pass');
  const err = document.getElementById('auth-err');
  const attempt = async () => {
    if (!input.value) return;
    const hash = await sha256Hex(input.value);
    const user = AUTH_USERS.find(u => u.hash === hash);
    if (user) {
      currentUser = user.slug;
      sessionStorage.setItem(AUTH_KEY, currentUser);
      showApp();
    } else {
      err.textContent = 'Невірний пароль';
      input.value = '';
      input.focus();
    }
  };
  btn.onclick = attempt;
  input.onkeydown = (e) => { if (e.key === 'Enter') attempt(); };
  input.focus();
}

function logout() {
  sessionStorage.removeItem(AUTH_KEY);
  currentUser = null;
  started = false;
  mode = null;
  document.getElementById('topbar').classList.add('hidden');
  document.querySelector('.wrap').classList.add('hidden');
  showGate();
}

function showApp() {
  document.getElementById('auth-gate').classList.add('hidden');
  document.querySelector('.wrap').classList.remove('hidden');
  init();
}

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
async function init() {
  root.innerHTML = '<div class="landing"><p>Завантаження питань…</p></div>';
  QUESTIONS = await loadQuestions();
  migrateOldProgress();
  try {
    const savedTopic = localStorage.getItem(TOPIC_FILTER_KEY);
    if (savedTopic && TOPIC_ORDER.includes(savedTopic)) topicFilter = savedTopic;
  } catch (e) {}
  render();
}

checkAuth();
