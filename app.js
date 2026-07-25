// ============================================================
// CCNP DCCOR Practice — квіз-рушій
// Дані: questions/manifest.json + questions/NNNN.json (кожне
// питання — окремий файл, зручно редагувати/додавати пізніше).
// ============================================================

const LETTERS = ['A','B','C','D','E','F'];
const STORAGE_KEY = 'dccor-quiz-progress-v1';

let QUESTIONS = [];         // масив питань у порядку id
let current = 0;            // індекс поточного питання
let answers = [];           // 'correct' | 'incorrect' | null, паралельно QUESTIONS
let userAnswerData = [];    // збережений вибір користувача (для перегляду)
let score = 0;
let answeredCount = 0;
let reviewFilter = 'all';   // 'all' | 'wrong'
let started = false;

const root = document.getElementById('app-root');

async function loadQuestions() {
  const manifestRes = await fetch('questions/manifest.json');
  const manifest = await manifestRes.json();
  const items = manifest.items.sort((a,b) => a.id - b.id);
  const all = await Promise.all(items.map(it => fetch('questions/' + it.file).then(r => r.json())));
  return all;
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      answers, userAnswerData, current, score, answeredCount
    }));
  } catch (e) {}
}

function resetProgress() {
  answers = new Array(QUESTIONS.length).fill(null);
  userAnswerData = new Array(QUESTIONS.length).fill(null);
  current = 0; score = 0; answeredCount = 0;
  saveProgress();
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
// LANDING
// ------------------------------------------------------------
function renderLanding() {
  const answeredN = answers.filter(a => a !== null).length;
  root.innerHTML = `
    <div class="landing">
      <h1>CCNP DCCOR — тренажер</h1>
      <p>350-601 DCCOR практичні питання з поясненнями. Прогрес зберігається у браузері автоматично.</p>
      <div class="landing-stats">
        <div class="landing-stat"><div class="num">${QUESTIONS.length}</div><div class="lbl">питань</div></div>
        <div class="landing-stat"><div class="num">${answeredN}</div><div class="lbl">пройдено</div></div>
        <div class="landing-stat"><div class="num">${score}</div><div class="lbl">правильно</div></div>
      </div>
      <div class="landing-actions">
        <button class="btn" id="start-btn">${answeredN > 0 ? 'Продовжити' : 'Почати'}</button>
        ${answeredN > 0 ? '<button class="btn secondary" id="restart-btn">Почати заново</button>' : ''}
      </div>
    </div>
  `;
  document.getElementById('topbar').classList.add('hidden');
  document.getElementById('start-btn').onclick = () => {
    started = true;
    render();
  };
  const restartBtn = document.getElementById('restart-btn');
  if (restartBtn) restartBtn.onclick = () => {
    if (confirm('Скинути весь прогрес і почати заново?')) {
      resetProgress();
      started = true;
      render();
    }
  };
}

// ------------------------------------------------------------
// TOPBAR
// ------------------------------------------------------------
function updateTopbar() {
  document.getElementById('topbar').classList.remove('hidden');
  document.getElementById('q-counter').textContent = `Питання ${current + 1} / ${QUESTIONS.length}`;
  document.getElementById('progress-bar').style.width = `${(current / QUESTIONS.length) * 100}%`;
  document.getElementById('stats').textContent = `Правильно: ${score} / ${answeredCount}`;
}

// ------------------------------------------------------------
// NAV DOTS
// ------------------------------------------------------------
function renderNavDots(container) {
  container.innerHTML = '';
  QUESTIONS.forEach((q, i) => {
    const d = document.createElement('div');
    d.className = 'dot';
    if (i === current) d.classList.add('current');
    if (answers[i] === 'correct') d.classList.add('answered-correct');
    if (answers[i] === 'incorrect') d.classList.add('answered-incorrect');
    d.title = 'Питання ' + (i + 1);
    d.textContent = i + 1;
    d.onclick = () => { current = i; render(); };
    container.appendChild(d);
  });
}

// ------------------------------------------------------------
// MAIN RENDER DISPATCH
// ------------------------------------------------------------
function render() {
  if (!started) { renderLanding(); return; }

  if (current >= QUESTIONS.length) { renderSummary(); return; }

  updateTopbar();

  const q = QUESTIONS[current];
  const card = document.createElement('div');
  card.className = 'card';

  const header = document.createElement('div');
  header.className = 'card-header';
  header.innerHTML = `<span>Питання #${q.id}${q.type === 'order' ? ' · впорядкування' : ''}${q.type === 'match' ? ' · зіставлення' : ''}${q.type === 'fill' ? ' · заповнення' : ''}</span>` +
    `<span>${q.needsAnswer ? '<span class="badge-warn">не підтверджено офіційно</span>' : ''} ${escapeHtml(q.topic||'')}</span>`;
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
  checkBtn.textContent = 'Перевірити';
  actions.appendChild(checkBtn);

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn secondary';
  prevBtn.textContent = '← Назад';
  prevBtn.disabled = current === 0;
  prevBtn.onclick = () => { current--; render(); };
  actions.appendChild(prevBtn);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn secondary';
  nextBtn.textContent = current === QUESTIONS.length - 1 ? 'Підсумок →' : 'Далі →';
  nextBtn.onclick = () => { current++; render(); };
  actions.appendChild(nextBtn);

  const homeBtn = document.createElement('button');
  homeBtn.className = 'btn secondary';
  homeBtn.textContent = 'На головну';
  homeBtn.onclick = () => { started = false; render(); };
  actions.appendChild(homeBtn);

  root.innerHTML = '';
  root.appendChild(card);
  card.appendChild(actions);

  const navWrap = document.createElement('div');
  navWrap.className = 'nav-dots';
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

function markChoice(q, selected) {
  const wrap = document.getElementById('choice-wrap');
  const correctSet = new Set(q.correct);
  const selSet = new Set(selected);
  [...wrap.children].forEach((el, i) => {
    el.style.cursor = 'default';
    if (correctSet.has(i)) el.classList.add('correct');
    else if (selSet.has(i)) el.classList.add('incorrect');
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

function markOrder(q) {
  const order = orderState[current];
  const rows = document.querySelectorAll('#order-list .order-item');
  rows.forEach((row, pos) => {
    row.querySelectorAll('button').forEach(b => b.disabled = true);
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

function markFill(q) {
  const selects = document.querySelectorAll('#fill-template select.fill-blank');
  selects.forEach(sel => {
    const idx = parseInt(sel.dataset.blank, 10);
    const correctVal = q.blankAnswers[idx];
    sel.disabled = true;
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

function markMatch(q) {
  const rows = document.querySelectorAll('#match-list .match-item');
  rows.forEach(row => {
    const i = parseInt(row.dataset.idx, 10);
    const sel = row.querySelector('select');
    sel.disabled = true;
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

  if (q.type === 'single' || q.type === 'multi') {
    const selected = checkChoice(q);
    if (selected.length === 0) { alert('Обери відповідь.'); return; }
    userData = selected;
    const correctSet = new Set(q.correct);
    const selSet = new Set(selected);
    isCorrect = correctSet.size === selSet.size && [...correctSet].every(x => selSet.has(x));
    markChoice(q, selected);
  } else if (q.type === 'order') {
    userData = orderState[current].slice();
    isCorrect = JSON.stringify(orderState[current]) === JSON.stringify(q.correctOrder);
    markOrder(q);
  } else if (q.type === 'fill') {
    const vals = getFillAnswers();
    if (vals.some(v => !v)) { alert('Заповни всі поля.'); return; }
    userData = vals;
    isCorrect = isFillCorrect(q);
    markFill(q);
  } else if (q.type === 'match') {
    const vals = getMatchAnswers();
    userData = vals;
    isCorrect = isMatchCorrect(q);
    markMatch(q);
  }

  answers[current] = isCorrect ? 'correct' : 'incorrect';
  userAnswerData[current] = userData;
  answeredCount++;
  if (isCorrect) score++;

  const feedback = document.getElementById('feedback');
  feedback.classList.add('show', isCorrect ? 'correct' : 'incorrect');
  feedback.textContent = isCorrect ? '✓ Правильно!' : '✗ Неправильно.';

  showExtras(q);
  updateTopbar();
  document.getElementById('check-btn').disabled = true;
  saveProgress();

  // оновити навдоти
  const navWrap = document.querySelector('.nav-dots');
  if (navWrap) renderNavDots(navWrap);
}

function showAlreadyAnswered(q) {
  const isCorrect = answers[current] === 'correct';
  const feedback = document.getElementById('feedback');
  feedback.classList.add('show', isCorrect ? 'correct' : 'incorrect');
  feedback.textContent = isCorrect ? '✓ Правильно!' : '✗ Неправильно.';

  if (q.type === 'single' || q.type === 'multi') {
    const wrap = document.getElementById('choice-wrap');
    (userAnswerData[current] || []).forEach(i => wrap.children[i] && wrap.children[i].classList.add('selected'));
    markChoice(q, userAnswerData[current] || []);
  } else if (q.type === 'order') {
    orderState[current] = userAnswerData[current] ? userAnswerData[current].slice() : orderState[current];
    drawOrderList(q, document.getElementById('order-list'));
    markOrder(q);
  } else if (q.type === 'fill') {
    restoreFillAnswers(userAnswerData[current]);
    markFill(q);
  } else if (q.type === 'match') {
    restoreMatchAnswers(userAnswerData[current]);
    markMatch(q);
  }
  showExtras(q);
}

// ------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------
function renderSummary() {
  document.getElementById('topbar').classList.remove('hidden');
  document.getElementById('q-counter').textContent = 'Підсумок';
  document.getElementById('progress-bar').style.width = '100%';
  document.getElementById('stats').textContent = `Правильно: ${score} / ${answeredCount}`;

  const pct = QUESTIONS.length ? Math.round((score / QUESTIONS.length) * 100) : 0;
  const wrongIds = QUESTIONS.filter((q, i) => answers[i] === 'incorrect').map(q => q.id);

  root.innerHTML = `
    <div class="card">
      <div class="card-header"><span>Результат</span></div>
      <div class="card-body summary">
        <h2>Тест завершено</h2>
        <div class="score">${score} / ${QUESTIONS.length}</div>
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
  document.getElementById('home-btn').onclick = () => { started = false; render(); };
}

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
async function init() {
  root.innerHTML = '<div class="landing"><p>Завантаження питань…</p></div>';
  QUESTIONS = await loadQuestions();

  const saved = loadProgress();
  if (saved && saved.answers && saved.answers.length === QUESTIONS.length) {
    answers = saved.answers;
    userAnswerData = saved.userAnswerData || new Array(QUESTIONS.length).fill(null);
    current = saved.current || 0;
    score = saved.score || 0;
    answeredCount = saved.answeredCount || 0;
  } else {
    resetProgress();
  }

  render();
}

init();
