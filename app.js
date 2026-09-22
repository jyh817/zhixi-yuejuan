/* ================= 智析阅卷 · 试卷分析系统 ================= */
/* 纯前端实现：localStorage 存业务数据，IndexedDB 存试卷归档文件 */
'use strict';

/* 构建版本：前端展示用，便于判断是否缓存了旧脚本 */
const APP_VERSION = '20260922k';

/* ---------- 科目字典 ---------- */
const SUBJECTS = [
  { id: 'chinese', name: '语文' },
  { id: 'math',    name: '数学' },
  { id: 'english', name: '英语' },
  { id: 'japanese',name: '日语' },
  { id: 'physics', name: '物理' },
  { id: 'chem',    name: '化学' },
  { id: 'bio',     name: '生物' },
  { id: 'history', name: '历史' },
  { id: 'geo',     name: '地理' },
  { id: 'politics',name: '政治' },
];
const DB = {
  templates: 'xj_templates',
  exams: 'xj_exams',
};

/* ---------- 小工具 ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const uid = () => 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const norm = (s = '') => String(s).replace(/[\s（）()：:，,。.、]/g, '').toLowerCase();
const toNum = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? NaN : n;
};
const stuTotal = (s) => Object.keys(s.scores || {}).reduce((a, k) => a + (toNum(s.scores[k]) || 0), 0);
function store(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function load(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
  catch (e) { return def; }
}
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toastWrap').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function subjectName(id) {
  const s = SUBJECTS.find(x => x.id === id);
  return s ? s.name : '未分类';
}

/* ---------- IndexedDB：归档文件 ---------- */
const idb = {
  db: null,
  open() {
    return new Promise((res) => {
      if (this.db) return res(this.db);
      const r = indexedDB.open('xj_archives', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => { this.db = null; res(null); };
    });
  },
  async put(key, val) {
    const db = await this.open(); if (!db) return;
    return new Promise((res) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  },
  async get(key) {
    const db = await this.open(); if (!db) return undefined;
    return new Promise((res) => {
      const tx = db.transaction('files', 'readonly');
      const rq = tx.objectStore('files').get(key);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(undefined);
    });
  },
  async del(key) {
    const db = await this.open(); if (!db) return;
    return new Promise((res) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(key);
      tx.oncomplete = () => res();
    });
  },
};

/* ============================================================
 *  全局状态
 * ========================================================== */
const state = {
  templates: load(DB.templates, []),
  exams: load(DB.exams, []),
  currentExamId: null,          // 分析页当前考试
  currentEditExamId: null,
  editExamPaperMeta: null,      // 暂存待保存的试卷文件信息
  editExamAnswerMeta: null,
  lastAnalysis: null,           // { examId, questions, students, classStats }
  activeStudent: null,
};

/* ============================================================
 *  导航
 * ========================================================== */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
document.querySelectorAll('[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.goto));
});
function switchView(name) {
  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'home') renderHome();
  if (name === 'oneclick') initWizard();
  if (name === 'templates') renderTemplates();
  if (name === 'exams') renderExams();
  if (name === 'analysis') renderAnalysisPage();
}

/* ============================================================
 *  首页
 * ========================================================== */
function renderHome() {
  const exams = state.exams;
  const students = exams.reduce((n, e) => n + (e.students ? e.students.length : 0), 0);
  const archived = exams.filter(e => e.hasPaper || e.hasAnswer).length;
  $('#statGrid').innerHTML = `
    <div class="stat-card"><div class="num">${exams.length}</div><div class="cap">已创建考试</div></div>
    <div class="stat-card"><div class="num">${students}</div><div class="cap">已录入学生</div></div>
    <div class="stat-card"><div class="num">${state.templates.length}</div><div class="cap">试题模板</div></div>
    <div class="stat-card"><div class="num">${archived}</div><div class="cap">已归档试卷</div></div>
  `;
}

/* ============================================================
 *  试题模板
 * ========================================================== */
function renderTemplates() {
  const box = $('#templateList');
  if (!state.templates.length) {
    box.innerHTML = `<div class="card"><p class="hint empty-hint">暂无试题模板，点击右上角"＋ 新建模板"开始创建。</p></div>`;
    return;
  }
  box.innerHTML = state.templates.map(t => `
    <div class="item-card" data-id="${t.id}">
      <span class="subject-chip">${subjectName(t.subjectId)}</span>
      <h3>${esc(t.name)}</h3>
      <div class="meta">${t.questions.length} 道小题 · 满分 ${totalMark(t)} 分</div>
      <div class="actions">
        <button class="mini-btn" data-act="edit" data-id="${t.id}">编辑</button>
        <button class="mini-btn" data-act="del" data-id="${t.id}">删除</button>
        <button class="mini-btn" data-act="use" data-id="${t.id}">用于考试</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = b.dataset.id, act = b.dataset.act;
    if (act === 'edit') openTplModal(id);
    if (act === 'del' && confirm('确定删除该模板？')) {
      state.templates = state.templates.filter(t => t.id !== id); saveTemplates();
    }
    if (act === 'use') { switchView('exams'); openExamModalForTemplate(id); }
  }));
  box.querySelectorAll('.item-card').forEach(c => c.addEventListener('click', () => openTplModal(c.dataset.id)));
}
const totalMark = (t) => t.questions.reduce((s, q) => s + (q.fullMark || 0), 0);
function saveTemplates() { store(DB.templates, state.templates); renderTemplates(); }

/* --- 模板编辑弹窗 --- */
function fillSubjects(sel, current) {
  sel.innerHTML = SUBJECTS.map(s => `<option value="${s.id}"${s.id === current ? ' selected' : ''}>${s.name}</option>`).join('');
}
function openTplModal(id) {
  const t = id ? state.templates.find(x => x.id === id) : null;
  $('#tplModalTitle').textContent = t ? '编辑模板' : '新建试题模板';
  fillSubjects($('#tplSubject'), t ? t.subjectId : '');
  $('#tplName').value = t ? t.name : '';
  const body = $('#qTable tbody');
  body.innerHTML = '';
  state._editTplId = id;
  (t ? t.questions : []).forEach(q => addQuestionRow(q));
  if (!t) for (let i = 0; i < 3; i++) addQuestionRow();
  $('#tplModal').classList.remove('hidden');
}
function addQuestionRow(q = {}) {
  const body = $('#qTable tbody');
  const tr = document.createElement('tr');
  const types = ['选择题', '填空题', '解答题', '计算题', '简答题', '阅读题', '完形填空', '书面表达', '翻译题', '作文', '实验题'];
  tr.innerHTML = `
    <td><input class="cell" value="${esc(q.qid || '')}" placeholder="Q1"></td>
    <td><input class="cell" style="width:96px" value="${esc(q.type || '')}" list="typeList"></td>
    <td><input style="width:100%;min-width:140px" value="${esc(q.knowledge || '')}" placeholder="如：二次函数"></td>
    <td><input class="cell" type="number" min="0" step="any" value="${q.fullMark != null ? q.fullMark : ''}"></td>
    <td><button class="icon-btn" title="删除">✕</button></td>`;
  tr.querySelector('.icon-btn').addEventListener('click', () => tr.remove());
  body.appendChild(tr);
}
$('#btnAddQ').addEventListener('click', () => addQuestionRow());
$('#btnQuickFill').addEventListener('click', () => {
  const n = parseInt(prompt('生成几道小题？', '5'), 10) || 5;
  const type = prompt('默认题型（如：选择题）', '选择题') || '选择题';
  const full = parseFloat(prompt('每题默认分值', '6')) || 0;
  for (let i = 0; i < n; i++) addQuestionRow({ qid: 'P' + (i + 1), type, knowledge: '', fullMark: full });
});
$('#btnSaveTpl').addEventListener('click', () => {
  const name = $('#tplName').value.trim();
  if (!name) { toast('请填写模板名称', 'err'); return; }
  const rows = [...$('#qTable tbody').querySelectorAll('tr')];
  const questions = rows.map((tr, i) => {
    const c = tr.querySelectorAll('input');
    const qid = c[0].value.trim() || 'Q' + (i + 1);
    return {
      sort: i + 1, qid,
      label: qid,
      type: c[1].value.trim() || '未分类',
      knowledge: c[2].value.trim() || '综合',
      fullMark: toNum(c[3].value) || 0,
    };
  }).filter(q => q.fullMark > 0 || q.type !== '未分类' || q.knowledge !== '综合');
  if (!questions.length) { toast('请至少录入一道题目', 'err'); return; }
  const editting = state._editTplId;
  if (editting) {
    const t = state.templates.find(x => x.id === editting);
    Object.assign(t, { name, subjectId: $('#tplSubject').value, questions });
  } else {
    state.templates.push({ id: uid(), name, subjectId: $('#tplSubject').value, questions });
  }
  saveTemplates();
  $('#tplModal').classList.add('hidden');
  toast('模板已保存');
});

/* ============================================================
 *  考试管理
 * ========================================================== */
function renderExams() {
  const box = $('#examList');
  if (!state.exams.length) {
    box.innerHTML = `<div class="card"><p class="hint empty-hint">暂无考试，点击右上角"＋ 创建考试"并上传试卷。</p></div>`;
    return;
  }
  box.innerHTML = state.exams.map(e => {
    const t = state.templates.find(x => x.id === e.templateId);
    return `
      <div class="item-card" data-id="${e.id}">
        <span class="subject-chip">${subjectName(e.subjectId)}</span>
        <h3>${esc(e.name)}</h3>
        <div class="meta">${e.date || '日期未填'} · 模板：${t ? esc(t.name) : '（已删除）'} · 学生 ${e.students ? e.students.length : 0} 人</div>
        <div class="actions">
          <button class="mini-btn" data-act="paper" data-id="${e.id}">试卷</button>
          <button class="mini-btn" data-act="answer" data-id="${e.id}">答案</button>
          <button class="mini-btn" data-act="edit" data-id="${e.id}">编辑</button>
          <button class="mini-btn" data-act="analyze" data-id="${e.id}">成绩分析</button>
          <button class="mini-btn" data-act="del" data-id="${e.id}">删除</button>
        </div>
      </div>`;
  }).join('');
  box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = b.dataset.id, act = b.dataset.act;
    const exam = state.exams.find(x => x.id === id);
    if (act === 'paper') openArchive(id, 'paper');
    if (act === 'answer') openArchive(id, 'answer');
    if (act === 'edit') openExamModal(id);
    if (act === 'analyze') { state.currentExamId = id; switchView('analysis'); }
    if (act === 'del' && confirm(`确定删除考试"${exam.name}"及其成绩？`)) {
      state.exams = state.exams.filter(x => x.id !== id); saveExams();
      idb.del('arc_' + id);
    }
  }));
  box.querySelectorAll('.item-card').forEach(c => c.addEventListener('click', () => openExamModal(c.dataset.id)));
}
function saveExams() { store(DB.exams, state.exams); renderExams(); }
function openExamModalForTemplate(tplId) {
  // 从首页"用于考试"进入时，预选模板
  state._preselect = { tplId };
  openExamModal(null);
}
function openExamModal(id) {
  const e = id ? state.exams.find(x => x.id === id) : null;
  state._editExamId = id;
  $('#examModalTitle').textContent = e ? '编辑考试' : '创建考试';
  fillSubjects($('#examSubject'), e ? e.subjectId : '');
  const subj = e ? e.subjectId : '';
  $('#examSubject').value = subj;
  // 模板选择：仅显示当前科目模板
  const preselectTpl = state._preselect ? state._preselect.tplId : null;
  fillTemplates($('#examTemplate'), e ? e.templateId : preselectTpl, subj);
  $('#examName').value = e ? e.name : '';
  $('#examDate').value = e ? (e.date || '') : new Date().toISOString().slice(0, 10);
  // 归档文件原信息
  state.editExamPaperMeta = e ? (e.paper ? { name: e.paper.name, type: e.paper.type, has: true } : null) : null;
  state.editExamAnswerMeta = e ? (e.answer ? { name: e.answer.name, type: e.answer.type, has: true } : null) : null;
  renderFileMeta();
  $('#paperFile').value = '';
  $('#answerFile').value = '';
  $('#examModal').classList.remove('hidden');
  delete state._preselect;
}
function fillTemplates(sel, current, subjId) {
  const list = state.templates.filter(t => t.subjectId === subjId);
  sel.innerHTML = list.length
    ? '<option value="">—— 选择模板 ——</option>' + list.map(t =>
        `<option value="${t.id}"${t.id === current ? ' selected' : ''}>${esc(t.name)}（${t.questions.length}题/满分${totalMark(t)}）</option>`).join('')
    : '<option value="">该科目暂无模板，请先创建</option>';
}
function renderFileMeta() {
  const pp = state.editExamPaperMeta;
  const pa = state.editExamAnswerMeta;
  $('#paperMeta').textContent = pp ? '已上传：' + pp.name : '尚未上传';
  $('#answerMeta').textContent = pa ? '已上传：' + pa.name : '尚未上传';
}
$('#paperFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) { state.editExamPaperMeta = { name: f.name, type: f.type, file: f }; renderFileMeta(); }
});
$('#answerFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) { state.editExamAnswerMeta = { name: f.name, type: f.type, file: f }; renderFileMeta(); }
});
async function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
$('#btnSaveExam').addEventListener('click', async () => {
  const name = $('#examName').value.trim();
  const subjectId = $('#examSubject').value;
  const templateId = $('#examTemplate').value;
  if (!name) { toast('请填写考试名称', 'err'); return; }
  if (!subjectId) { toast('请选择科目', 'err'); return; }
  if (!templateId) { toast('请选择试题模板', 'err'); return; }
  const editting = state._editExamId;
  let exam;
  if (editting) exam = state.exams.find(x => x.id === editting);
  else { exam = { id: uid(), students: [] }; state.exams.unshift(exam); }
  exam.name = name;
  exam.subjectId = subjectId;
  exam.templateId = templateId;
  exam.date = $('#examDate').value;
  // 允许更换模板时同步成绩列；保留已有的、剔除无效的
  const tpl = state.templates.find(t => t.id === templateId);
  if (exam.students && tpl) {
    exam.students.forEach(st => {
      const keep = {};
      tpl.questions.forEach(q => { if (st.scores && st.scores[q.qid] != null) keep[q.qid] = st.scores[q.qid]; });
      st.scores = keep;
    });
  } else if (!tpl) { exam.students = []; }
  // 归档文件
  if (state.editExamPaperMeta && state.editExamPaperMeta.file) {
    const dataUrl = await readAsDataURL(state.editExamPaperMeta.file);
    await idb.put('arc_' + exam.id, await mergeArc(exam.id, { paper: { name: state.editExamPaperMeta.name, type: state.editExamPaperMeta.type, dataUrl } }));
    exam.paper = { name: state.editExamPaperMeta.name, type: state.editExamPaperMeta.type };
    exam.hasPaper = true;
  } else if (!state.editExamPaperMeta) { exam.paper = null; exam.hasPaper = false; }
  if (state.editExamAnswerMeta && state.editExamAnswerMeta.file) {
    const dataUrl = await readAsDataURL(state.editExamAnswerMeta.file);
    await idb.put('arc_' + exam.id, await mergeArc(exam.id, { answer: { name: state.editExamAnswerMeta.name, type: state.editExamAnswerMeta.type, dataUrl } }));
    exam.answer = { name: state.editExamAnswerMeta.name, type: state.editExamAnswerMeta.type };
    exam.hasAnswer = true;
  } else if (!state.editExamAnswerMeta) { exam.answer = null; exam.hasAnswer = false; }
  saveExams();
  $('#examModal').classList.add('hidden');
  toast('考试已保存');
});
async function mergeArc(examId, patch) {
  const old = await idb.get('arc_' + examId) || {};
  return Object.assign({}, old, patch);
}

/* --- 归档预览 --- */
async function openArchive(examId, which) {
  const exam = state.exams.find(x => x.id === examId);
  const arc = await idb.get('arc_' + examId);
  const file = arc && (which === 'paper' ? arc.paper : arc.answer);
  $('#archiveTitle').textContent = (which === 'paper' ? '试卷' : '答案') + ' · ' + exam.name + (file ? ' — ' + file.name : '');
  const body = $('#archiveBody');
  if (!file || !file.dataUrl) {
    body.innerHTML = `<p class="hint empty-hint">该考试未上传${which === 'paper' ? '试卷' : '答案'}文件。</p>`;
  } else {
    await renderPreview(body, file);
  }
  $('#archiveModal').classList.remove('hidden');
}
function renderPreview(el, file) {
  return new Promise(async (res) => {
    const lower = (file.name || '').toLowerCase();
    if (/pdf$/.test(lower) || file.type === 'application/pdf') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      try {
        const data = file.dataUrl.split(',')[1];
        const bin = atob(data);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const pdf = await pdfjsLib.getDocument({ data: arr }).promise;
        el.innerHTML = '<div style="display:grid;gap:10px;justify-items:center"></div>';
        const wrap = el.firstChild;
        const total = Math.min(pdf.numPages, 8);
        for (let p = 1; p <= total; p++) {
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 1.2 });
          const cvs = document.createElement('canvas');
          cvs.width = viewport.width; cvs.height = viewport.height;
          const ctx = cvs.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
          wrap.appendChild(cvs);
        }
      } catch (err) { el.innerHTML = `<p class="hint">PDF 解析失败：${esc(err.message)}</p>`; }
    } else if (/docx?$/.test(lower) || /word/.test(file.type)) {
      try {
        const data = await (await fetch(file.dataUrl)).arrayBuffer();
        const html = await mammoth.convertToHtml({ arrayBuffer: data });
        el.innerHTML = `<div style="padding:24px;background:#fff;border:1px solid var(--line);border-radius:10px;max-width:820px;margin:0 auto">${html.value}</div>`;
      } catch (err) { el.innerHTML = `<p class="hint">Word 解析失败：${esc(String(err))}</p>`; }
    } else {
      el.innerHTML = `<p class="hint">该文件类型暂不支持预览，请下载查看。</p>`;
    }
    res();
  });
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
  $('#tplModal').classList.add('hidden');
  $('#examModal').classList.add('hidden') ;
  $('#archiveModal').classList.add('hidden');
  $('#smartModal').classList.add('hidden');
}));
$('#btnNewTemplate').addEventListener('click', () => openTplModal(null));
$('#btnNewExam').addEventListener('click', () => openExamModal(null));

/* ============================================================
 *  成绩与分析页
 * ========================================================== */
function renderAnalysisPage() {
  const sel = $('#anaExam');
  const cur = state.currentExamId;
  sel.innerHTML = '<option value="">—— 请选择题号模板对应的考试 ——</option>' +
    state.exams.map(e => `<option value="${e.id}"${e.id === cur ? ' selected' : ''}>${esc(e.name)}（${subjectName(e.subjectId)}）</option>`).join('');
  // 无考试时
  $('#btnAnalyze').disabled = !cur;
  if (cur) loadExamForAnalysis(cur);
  else {
    $('#anaCount').textContent = '0';
    $('#scoreHint').classList.remove('hidden');
    $('#scoreWrap').style.display = 'none';
    $('#resultCard').classList.remove('hidden');
    $('#anaHint').classList.remove('hidden');
    $('#anaResult').classList.add('hidden');
  }
}
$('#anaExam').addEventListener('change', (e) => {
  state.currentExamId = e.target.value || null;
  renderAnalysisPage();
});

function currentExam() { return state.exams.find(x => x.id === state.currentExamId) || null; }
function currentTpl() {
  const e = currentExam();
  return e ? state.templates.find(t => t.id === e.templateId) : null;
}

function loadExamForAnalysis(examId) {
  const exam = currentExam();
  const tpl = currentTpl();
  if (!exam || !tpl) {
    $('#anaCount').textContent = '0';
    $('#scoreHint').classList.remove('hidden');
    $('#scoreWrap').style.display = 'none';
    $('#resultCard').classList.remove('hidden');
    $('#anaHint').classList.remove('hidden');
    $('#anaResult').classList.add('hidden');
    return;
  }
  $('#anaCount').textContent = exam.students.length;
  if (!exam.students.length) {
    $('#scoreHint').classList.remove('hidden');
    $('#scoreWrap').style.display = 'none';
  } else {
    $('#scoreHint').classList.add('hidden');
    $('#scoreWrap').style.display = 'block';
    renderScoreTable();
  }
  // 报告区
  if (state.lastAnalysis && state.lastAnalysis.examId === exam.id) {
    renderAnalysisResult();
  } else {
    $('#anaResult').classList.add('hidden');
    $('#anaHint').classList.remove('hidden');
    $('#btnAnalyze').disabled = false;
  }
}

/* --- 小题成绩表格（在线编辑） --- */
function renderScoreTable(targetSel) {
  const exam = currentExam(), tpl = currentTpl();
  const table = $(targetSel || '#scoreTable');
  let html = '<thead><tr><th style="min-width:70px">学号</th><th style="min-width:70px">姓名</th>';
  tpl.questions.forEach(q => html += `<th title="${esc(q.knowledge)}">${esc(q.qid)}<br><span style="font-size:11px;color:#94a3b8">/${q.fullMark || ''}</span></th>`);
  html += '<th style="min-width:70px">总分</th><th style="min-width:50px"></th></tr></thead><tbody>';
  exam.students.forEach(st => {
    html += `<tr data-id="${st.id}">
      <td><input class="cell" data-f="no" value="${esc(st.no || '')}"></td>
      <td><input class="cell" data-f="name" value="${esc(st.name || '')}"></td>`;
    tpl.questions.forEach(q => {
      const v = st.scores[q.qid];
      html += `<td><input class="cell" type="number" min="0" step="any" data-q="${esc(q.qid)}" value="${v != null ? v : ''}"></td>`;
    });
    html += `<td class="row-total">${stuTotal(st)}</td>
      <td><button class="icon-btn row-del" title="删除">✕</button></td></tr>`;
  });
  html += '</tbody>';
  table.innerHTML = html;
  // 事件
  table.querySelectorAll('.row-del').forEach(b => b.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    const id = tr.dataset.id;
    exam.students = exam.students.filter(s => s.id !== id);
    saveExamsSilent(); renderScoreTable(targetSel); updateDirtyAnalyze();
  }));
  table.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
    const tr = inp.closest('tr');
    const st = exam.students.find(s => s.id === tr.dataset.id);
    if (!st) return;
    setStudentField(st, inp.dataset.f, inp.dataset.q, inp.value);
    saveExamsSilent();
    const tot = tr.querySelector('.row-total');
    tot.textContent = stuTotal(st);
    updateDirtyAnalyze();
  }));
}
function setStudentField(st, field, qid, value) {
  if (field === 'no') st.no = value.trim();
  else if (field === 'name') st.name = value.trim();
  else if (qid) {
    const v = value === '' ? 0 : toNum(value);
    st.scores = st.scores || {};
    st.scores[qid] = isNaN(v) ? 0 : Math.max(0, v);
  }
}
function saveExamsSilent() {
  // 移除运行时方法再序列化
  const clone = state.exams.map(e => Object.assign({}, e, { students: (e.students || []).slice() }));
  store(DB.exams, clone);
}
function updateDirtyAnalyze() {
  const exam = currentExam();
  const ok = exam && exam.students.length;
  $('#btnAnalyze').disabled = !ok;
  if (ok && state.lastAnalysis && state.lastAnalysis.examId === exam.id) {
    // 数据有变，重新生成
    runAnalysis();
  }
}

/* ============================================================
 *  Excel 导入
 * ========================================================== */
$('#btnDownloadTpl').addEventListener('click', () => {
  const tpl = currentTpl();
  if (!tpl) { toast('请先选择考试', 'err'); return; }
  const data = [['学号', '姓名'].concat(tpl.questions.map(q => q.qid))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '成绩录入模板');
  XLSX.writeFile(wb, '成绩录入模板-' + (currentExam()?.name || '') + '.xlsx');
  toast('已下载录入模板');
});
$('#btnImportXlsx').addEventListener('click', () => $('#xlsxFile').click());
$('#xlsxFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const exam = currentExam(), tpl = currentTpl();
  if (!exam || !tpl) { toast('请先选择考试', 'err'); return; }
  try {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 2) { toast('文件内容为空', 'err'); return; }
    const headers = rows[0].map(h => String(h).trim());
    // 定位姓名/学号列
    const nameIdx = headers.findIndex(h => /姓名|学生|name/i.test(h));
    const noIdx = headers.findIndex(h => /学号|考号|id/i.test(h) && !/姓名/.test(h));
    const qHeadIdx = [];
    tpl.questions.forEach(q => {
      const hq = q.qid;
      let idx = headers.findIndex(h => norm(h) === norm(hq) || norm(h) === 'q' + (q.sort) || norm(h) === 'p' + (q.sort));
      qHeadIdx.push(idx);
    });
    // 若语义匹配失败，退化为按列位置（仅当题目列数量恰好等于模板题数时）
    const matchedCount = qHeadIdx.filter(i => i >= 0).length;
    const allQIdx = headers.map((h, i) => ({ h: h.trim(), i }))
      .filter(x => /^(q|p)?\d+$/i.test(x.h)).map(x => x.i);
    if (matchedCount < tpl.questions.length && allQIdx.length === tpl.questions.length) {
      for (let k = 0; k < tpl.questions.length; k++) qHeadIdx[k] = allQIdx[k];
    }
    if (qHeadIdx.every(i => i < 0)) { toast('未识别到小题列，请使用下载的录入模板', 'err'); return; }

    let added = 0, skipped = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || (nameIdx < 0 && noIdx < 0)) continue;
      const name = nameIdx >= 0 ? String(row[nameIdx]).trim() : '';
      const no = noIdx >= 0 ? String(row[noIdx]).trim() : '';
      if (!name && !no) continue;
      // 去重：同姓名同考号视为同一学生
      const exist = exam.students.find(s => (s.no && no && s.no === no) || (name && s.name === name));
      const st = exist || { id: uid(), name, no, scores: {} };
      let empty = true;
      tpl.questions.forEach((q, i) => {
        const idx = qHeadIdx[i];
        const v = idx >= 0 ? row[idx] : 0;
        st.scores[q.qid] = v === '' || v == null ? 0 : Math.max(0, toNum(v) || 0);
        if (v !== '' && v != null) empty = false;
      });
      if (!exist) { exam.students.push(st); added++; }
      else { skipped++; }
    }
    if (added === 0 && skipped === 0) { toast('未导入任何学生数据', 'err'); return; }
    // 满分自修复：扫描版 OCR 对单题满分偶有缺失或误判，用本卷该题实收最高分校正，
    // 消除「得分超满分」的假告警与空满「/」。
    let repaired = 0;
    for (const q of tpl.questions) {
      let obs = 0;
      for (const s of exam.students) { const v = toNum((s.scores || {})[q.qid]) || 0; if (v > obs) obs = v; }
      if (obs > 0 && (!q.fullMark || q.fullMark < obs)) { q.fullMark = obs; repaired++; }
    }
    saveExamsSilent();
    renderScoreTable();
    renderAnalysisPage();
    toast(`导入完成：新增 ${added} 人${skipped ? '，更新 ' + skipped + ' 人' : ''}${repaired ? '，已自动校正 ' + repaired + ' 题满分' : ''}`);
  } catch (err) {
    toast('导入失败：' + err.message, 'err');
  }
});
$('#btnClearScores').addEventListener('click', () => {
  const exam = currentExam();
  if (!exam) return;
  if (confirm('确定清空当前考试的所有学生成绩？此操作不可恢复。')) {
    exam.students = [];
    saveExamsSilent(); renderScoreTable(); renderAnalysisPage();
  }
});

/* ============================================================
 *  规则引擎
 * ========================================================== */
function runAnalysis() {
  const exam = currentExam(), tpl = currentTpl();
  if (!exam || !tpl || !exam.students.length) return;
  const questions = tpl.questions.slice().sort((a, b) => a.sort - b.sort);
  const students = exam.students.map(s => {
    const total = Object.keys(questions).reduce((acc, _, i) => {
      const q = questions[i];
      return acc + (toNum(s.scores[q.qid]) || 0);
    }, 0);
    return { id: s.id, no: s.no, name: s.name, scores: s.scores || {}, total };
  });
  // 排序：按总分
  students.sort((a, b) => b.total - a.total);
  students.forEach((s, i) => s.rank = i + 1);
  // 班级逐题统计
  const classStats = questions.map(q => {
    const vals = students.map(s => toNum(s.scores[q.qid]) || 0);
    const avg = vals.reduce((a, b) => a + b, 0) / students.length;
    const avgRate = avg / (q.fullMark || 1);
    const difficulty = avgRate >= 0.75 ? '易' : (avgRate >= 0.5 ? '中' : '较难');
    const weak = students.filter(s => (toNum(s.scores[q.qid]) || 0) < q.fullMark * 0.6);
    const calcLoss = students.filter(s => {
      const v = toNum(s.scores[q.qid]) || 0;
      return v > 0 && v < q.fullMark * 0.6; // 计算出错的信号
    }).length;
    return { q, avg, avgRate, difficulty, weak, weakCount: weak.length, loss: 1 - avgRate };
  });
  // 学生个体分析
  const std = students.map(s => analyzeStudent(s, questions, classStats));
  state.lastAnalysis = { examId: exam.id, exam, tpl, questions, classStats, std };
  renderAnalysisResult();
}

function analyzeStudent(s, questions, classStats) {
  const items = questions.map(q => {
    const sc = toNum(s.scores[q.qid]) || 0;
    const full = q.fullMark || 1;
    const rate = sc / full;
    const cs = classStats.find(c => c.q.qid === q.qid);
    const diff = rate - cs.avgRate; // 相对班平的得分率差
    const loss = full - sc;
    return { q, score: sc, full, rate, loss, diff, classAvg: cs.avg, classAvgRate: cs.avgRate, difficulty: cs.difficulty };
  });
  // 薄弱点：失分多 且 明显低于班平 或 得分率低
  const weak = items
    .filter(i => i.loss > 0 && (i.diff < -0.1 || i.rate < 0.6))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 3);
  // 优势点：得分率高且高于班平
  const strong = items
    .filter(i => i.rate >= 0.8 && i.diff >= 0.05 && i.full > 0)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3);
  // 题型倾向
  const typeGroups = {};
  items.forEach(i => {
    const t = i.q.type || '未分类';
    (typeGroups[t] = typeGroups[t] || { full: 0, get: 0, count: 0 }).full += i.full;
    typeGroups[t].get += i.score;
    typeGroups[t].count++;
  });
  const typeRates = Object.entries(typeGroups).map(([type, g]) => ({ type, rate: g.full ? g.get / g.full : 0, get: g.get, full: g.full }))
    .sort((a, b) => a.rate - b.rate);
  const weakType = typeRates.length ? typeRates[0] : null;
  const strongType = typeRates.length ? typeRates[typeRates.length - 1] : null;
  // 复习建议
  const advice = buildAdvice(weak, weakType, strong, items, s.total);
  const fmtRate = (r) => (r * 100).toFixed(0) + '%';
  return { ...s, items, weak, strong, typeRates, weakType, strongType, advice, fmtRate };
}

function buildAdvice(weak, weakType, strong, items, total) {
  const parts = [];
  if (weak.length) {
    const kws = [...new Set(weak.map(i => i.q.knowledge))];
    parts.push('当前最需突破的薄弱点集中在【' + kws.join('、') + '】等知识板块，建议结合错题进行专项限时训练');
  }
  if (weakType) parts.push('在' + weakType.type + '题型上失分相对突出（得分率约' + (weakType.rate * 100).toFixed(0) + '%），建议加强该类题型的答题规范与思路训练');
  if (strong && strong.rate >= 0.8) parts.push('在【' + strong.type + '】方面表现稳定，可保持优势并尝试冲击更高难度题目');
  if (weak.some(i => i.difficulty === '易')) parts.push('请重视基础分，低难度题失分要优先复盘，避免基础不牢影响整体得分');
  if (!parts.length) parts.push('各题得分均衡，重点放在保持状态与拔高训练上');
  parts.push('建议针对失分题逐题整理错因（识记错误/方法不当/粗心计算），形成个性化错题本后每周复习');
  return parts;
}

/* ============================================================
 *  分析结果渲染
 * ========================================================== */
function renderAnalysisResult() {
  if (!state.lastAnalysis) return;
  const A = state.lastAnalysis;
  $('#anaHint').classList.add('hidden');
  $('#anaResult').classList.remove('hidden');
  const totals = A.std.map(s => s.total);
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const max = Math.max(...totals), min = Math.min(...totals);
  const tplTotal = A.tpl.questions.reduce((s, q) => s + (q.fullMark || 0), 0);
  const passLine = tplTotal * 0.6, great = tplTotal * 0.85;
  const passCount = totals.filter(t => t >= passLine).length;
  const greatCount = totals.filter(t => t >= great).length;
  $('#classSummary').innerHTML = `
    <div class="class-kpi"><div class="t">参考人数</div><div class="n">${A.std.length}</div></div>
    <div class="class-kpi"><div class="t">平均分</div><div class="n">${avg.toFixed(1)}</div></div>
    <div class="class-kpi"><div class="t">最高 / 最低</div><div class="n">${max} / ${min}</div></div>
    <div class="class-kpi"><div class="t">及格率（≥${passLine.toFixed(0)}）</div><div class="n">${(passCount / A.std.length * 100).toFixed(0)}%</div></div>
    <div class="class-kpi"><div class="t">优秀率（≥${great.toFixed(0)}）</div><div class="n">${(greatCount / A.std.length * 100).toFixed(0)}%</div></div>`;
  // 逐题统计表
  $('#qStatTable').innerHTML = `<thead><tr>
    <th>题号</th><th>题型</th><th>知识点</th><th>满分</th><th>班均分</th><th>得分率</th><th>失分率</th><th>难度</th><th>薄弱人数</th><th>薄弱学生</th>
    </tr></thead><tbody>` +
    A.classStats.map(c => {
      const badge = c.difficulty === '易' ? '<span class="badge ok">易</span>' : c.difficulty === '中' ? '<span class="badge mid">中</span>' : '<span class="badge bad">较难</span>';
      const weakNames = c.weak.slice(0, 3).map(s => esc(s.name)).join('、') + (c.weak.length > 3 ? ` 等${c.weak.length}人` : '');
      return `<tr><td>${esc(c.q.qid)}</td><td>${esc(c.q.type)}</td><td>${esc(c.q.knowledge)}</td>
        <td>${c.q.fullMark}</td><td>${c.avg.toFixed(1)}</td><td>${(c.avgRate * 100).toFixed(0)}%</td>
        <td>${(c.loss * 100).toFixed(0)}%</td><td>${badge}</td><td>${c.weakCount}</td><td class="hint">${weakNames}</td></tr>`;
    }).join('') + '</tbody>';
  // 学生一览
  $('#stuOverviewTable').innerHTML = `<thead><tr>
    <th>排名</th><th>学号</th><th>姓名</th><th>总分</th><th>得分率</th><th>班级分位</th><th>优势题型</th><th>薄弱题型</th>
    </tr></thead><tbody>` +
    A.std.map((s, i) => `
      <tr data-stu="${i}" class="stu-row" style="cursor:pointer">
        <td>${s.rank}</td><td>${esc(s.no || '')}</td><td>${esc(s.name)}</td>
        <td style="font-weight:700">${s.total}</td><td>${s.fmtRate(s.total / tplTotal)}</td>
        <td>${s.rank <= Math.ceil(A.std.length * 0.25) ? '前25%' : s.rank <= Math.ceil(A.std.length * 0.5) ? '中上' : s.rank <= Math.ceil(A.std.length * 0.75) ? '中下' : '后段'}</td>
        <td>${s.strongType ? esc(s.strongType.type) : '—'}</td>
        <td>${s.weakType ? esc(s.weakType.type) : '—'}</td>
      </tr>`).join('') + '</tbody>';
  $('#stuOverviewTable').querySelectorAll('.stu-row').forEach(r => r.addEventListener('click', () => {
    const i = +r.dataset.stu;
    renderStudentDetail(A.std[i]);
  }));
  // 默认展示第一名
  renderStudentDetail(A.std[0]);
}

function renderStudentDetail(s) {
  state.activeStudent = s;
  const A = state.lastAnalysis;
  const tplTotal = A.tpl.questions.reduce((sum, q) => sum + (q.fullMark || 0), 0);
  const weekHtml = s.weak.length ? s.weak.map(i =>
    `<span class="tag warn">${esc(i.q.qid)} ${esc(i.q.knowledge)}（得分率${(i.rate * 100).toFixed(0)}%）</span>`).join('') : '<span class="hint">无明显薄弱点</span>';
  const strongHtml = s.strong.length ? s.strong.map(i =>
    `<span class="tag">${esc(i.q.qid)} ${esc(i.q.knowledge)}（得分率${(i.rate * 100).toFixed(0)}%）</span>`).join('') : '<span class="hint">暂无显著优势点，需挖掘</span>';
  $('#stuDetail').innerHTML = `
    <div class="stu-detail">
      <h4>${esc(s.name)} <span class="subject-chip">第 ${s.rank} 名 / 总分 ${s.total} / 得分率 ${(s.total / tplTotal * 100).toFixed(0)}%</span></h4>
      <div style="margin-bottom:8px"><b>优势点：</b>${strongHtml}</div>
      <div style="margin-bottom:12px"><b>薄弱点：</b>${weekHtml}</div>
      <table><thead><tr><th>题号</th><th>题型</th><th>知识点</th><th>满分</th><th>得分</th><th>得分率</th><th>失分</th><th>班平得分率</th><th>逐题评价</th></tr></thead><tbody>
        ${s.items.map(i => {
          const b = i.diff >= 0.05 ? '<span class="badge ok">优于班平</span>' : i.diff <= -0.05 ? '<span class="badge bad">低于班平</span>' : '<span class="badge mid">持平</span>';
          return `<tr>
            <td>${esc(i.q.qid)}</td><td>${esc(i.q.type)}</td><td>${esc(i.q.knowledge)}</td>
            <td>${i.full}</td><td style="font-weight:600">${i.score}</td><td>${(i.rate * 100).toFixed(0)}%</td>
            <td>${i.loss}</td><td>${(i.classAvgRate * 100).toFixed(0)}% ${b}</td>
            <td style="text-align:left;max-width:340px">${commentsFor(i)}</td>
          </tr>`;
        }).join('')}
      </tbody></table>
      <div style="margin-top:14px"><b>整体评价：</b><p style="color:#334155">${overallComment(s, A)}</p></div>
      <div style="margin-top:8px"><b>复习建议：</b><ul style="margin-left:18px">${s.advice.map(a => `<li style="white-space:normal">${a}</li>`).join('')}</ul></div>
    </div>`;
}

/* --- 逐题评语 --- */
function commentsFor(i) {
  const k = i.q.knowledge;
  if (i.score >= i.full && i.full > 0) return '本小题满分，掌握扎实，可保持。';
  if (i.score <= 0) return `本小题完全失分（${i.score}/${i.full}），【${k}】理解明显不足，需从基础概念开始补起。`;
  const r = i.rate, diff = i.diff, loss = i.loss;
  if (r >= 0.8) return diff >= 0.05 ? `得分率${(r * 100).toFixed(0)}%，优于班级平均，掌握良好，仅需关注${k}中的细节规范。` : `得分率${(r * 100).toFixed(0)}%，处于班级水平，仍有${loss}分提升空间，可针对${k}做巩固。`;
  if (r >= 0.6) return `得分率${(r * 100).toFixed(0)}%${diff < 0 ? '，略低于班平均' : '，略高于班平均'}，在【${k}】上存在${loss}分隐性失分，多为方法或计算疏忽，建议精练同类题总结通法。`;
  if (r >= 0.4) return `得分率${(r * 100).toFixed(0)}%，本小题失分较多（${loss}分），【${k}】掌握不牢，建议回归教材例题并做针对训练。`;
  return `得分率${(r * 100).toFixed(0)}%，严重失分（仅在${i.full}分中得${i.score}分），【${k}】属于当前明显短板，建议专题突破并阶段性复查。`;
}
/* --- 整体评价 --- */
function overallComment(s, A) {
  const tplTotal = A.tpl.questions.reduce((sum, q) => sum + (q.fullMark || 0), 0);
  const rate = s.total / tplTotal;
  const pos = rate >= 0.85 ? '本次表现优秀，处于班级前列，综合能力突出' :
    rate >= 0.6 ? '整体表现良好，达到基本要求，具备一定基础与解题能力' :
    rate >= 0.4 ? '整体处于中下游，基础部分仍存在明显漏洞，需下大力气夯实' :
    '整体基础较为薄弱，当前得分偏低，急需进行系统性的基础巩固';
  const wt = s.weakType ? `薄弱环节主要在【${s.weakType.type}】题型` : '';
  const st = s.strongType && s.strongType.rate >= 0.8 ? `，相对优势在于【${s.strongType.type}】题型` : '';
  const weakK = s.weak.length ? `，最需先解决的知识点是【${[...new Set(s.weak.map(i => i.q.knowledge))].join('、')}】` : '';
  return `${s.name}同学本次考试总分${s.total}分，班级排名第${s.rank}名，得分率${(rate * 100).toFixed(0)}%。${pos}。${wt}${st}${weakK}。建议在保证优势题型的前提下，集中攻克薄弱知识点，注意答题规范与审题仔细，逐步提升单题得分率。`;
}

/* ============================================================
 *  Excel 导出
 * ========================================================== */
function aoaSheet(wsName, aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (widths) ws['!cols'] = widths.map(w => ({ wch: w }));
  return ws;
}
const DISCLAIMER = '本报告由“智析阅卷”系统依据已录入数据自动生成，结果与评价仅供参考，最终结论请结合任课教师的教学判断综合釆用。';
// 班级整体分析
$('#btnExportClass').addEventListener('click', () => {
  const A = state.lastAnalysis;
  if (!A) { toast('请先生成分析报告', 'err'); return; }
  const tplTotal = A.tpl.questions.reduce((s, q) => s + (q.fullMark || 0), 0);
  const totals = A.std.map(s => s.total);
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const max = Math.max(...totals), min = Math.min(...totals);
  const pass = totals.filter(t => t >= tplTotal * 0.6).length;
  const great = totals.filter(t => t >= tplTotal * 0.85).length;

  const wb = XLSX.utils.book_new();
  // 1 整体统计
  wb.SheetNames.push('整体统计');
  wb.Sheets['整体统计'] = aoaSheet('整体统计', [
    ['班级整体统计', ''],
    ['考试', A.exam.name],
    ['科目', subjectName(A.exam.subjectId)],
    ['考生人数', A.std.length],
    ['试卷满分', tplTotal],
    ['平均分', +avg.toFixed(1)],
    ['最高分', max],
    ['最低分', min],
    ['及格率(≥' + (tplTotal * 0.6).toFixed(0) + ')', (pass / A.std.length * 100).toFixed(0) + '%'],
    ['优秀率(≥' + (tplTotal * 0.85).toFixed(0) + ')', (great / A.std.length * 100).toFixed(0) + '%'],
    ['', ''],
    ['分数段', '人数'],
    ...gradeBands(totals, tplTotal),
    ['', ''],
    ['免责声明', DISCLAIMER],
  ], [26, 18]);
  // 2 逐题统计
  wb.SheetNames.push('逐题统计');
  wb.Sheets['逐题统计'] = aoaSheet('逐题统计', [
    ['题号', '题型', '知识点', '满分', '班均分', '得分率', '失分率', '难度', '薄弱人数', '薄弱学生名单'],
    ...A.classStats.map(c => [c.q.qid, c.q.type, c.q.knowledge, c.q.fullMark, +c.avg.toFixed(1), (c.avgRate * 100).toFixed(0) + '%', (c.loss * 100).toFixed(0) + '%', c.difficulty, c.weakCount, c.weak.map(w => w.name).join('、')]),
  ], [10, 12, 20, 8, 10, 10, 10, 8, 10, 40]);
  // 3 学生一览
  wb.SheetNames.push('学生整体一览');
  wb.Sheets['学生整体一览'] = aoaSheet('学生整体一览', [
    ['排名', '学号', '姓名', '总分', '得分率', '班级分位', '优势题型', '薄弱题型', '整体评语'],
    ...A.std.map(s => [s.rank, s.no || '', s.name, s.total, (s.total / tplTotal * 100).toFixed(0) + '%',
      s.rank <= Math.ceil(A.std.length * 0.25) ? '前25%' : s.rank <= Math.ceil(A.std.length * 0.5) ? '中上' : s.rank <= Math.ceil(A.std.length * 0.75) ? '中下' : '后段',
      s.strongType ? s.strongType.type : '—', s.weakType ? s.weakType.type : '—', overallComment(s, A)]),
  ], [8, 14, 12, 10, 10, 12, 14, 14, 60]);
  XLSX.writeFile(wb, '班级整体分析-' + A.exam.name + '.xlsx');
  toast('已导出班级整体分析');
});
function gradeBands(totals, total) {
  const bands = [
    ['优秀(≥' + (total * 0.85).toFixed(0) + ')', totals.filter(t => t >= total * 0.85).length],
    ['良好(≥' + (total * 0.7).toFixed(0) + ')', totals.filter(t => t >= total * 0.7 && t < total * 0.85).length],
    ['及格(≥' + (total * 0.6).toFixed(0) + ')', totals.filter(t => t >= total * 0.6 && t < total * 0.7).length],
    ['不及格(<' + (total * 0.6).toFixed(0) + ')', totals.filter(t => t < total * 0.6).length],
  ];
  return bands;
}
// 学生个人评价报告
$('#btnExportStudents').addEventListener('click', () => {
  const A = state.lastAnalysis;
  if (!A) { toast('请先生成分析报告', 'err'); return; }
  const wb = XLSX.utils.book_new();
  const names = new Set();
  const clean = sname => {
    let n = (sname || '').replace(/[\/\\*?:\[\]]/g, '').slice(0, 20);
    let c = n, i = 1; while (names.has(c)) { c = n + (i++); } names.add(c); return c;
  };
  // 目录
  wb.SheetNames.push('目录');
  wb.Sheets['目录'] = aoaSheet('目录', [
    ['学生个人评价报告', ''],
    ['考试', A.exam.name],
    ['科目', subjectName(A.exam.subjectId)],
    ['参考人数', A.std.length],
    ['', ''],
    ['班级排名', '姓名', '对应工作表'],
    ...A.std.map(s => [s.rank, s.name, clean(s.name)]),
    ['', ''],
    ['免责声明', DISCLAIMER],
  ], [18, 22, 24]);
  // 每个学生一个工作表
  A.std.forEach(s => {
    const sheetName = clean(s.name);
    wb.SheetNames.push(sheetName);
    const tplTotal = A.tpl.questions.reduce((sum, q) => sum + (q.fullMark || 0), 0);
    const rows = [
      ['学生个人评价报告', ''],
      ['姓名', s.name],
      ['学号', s.no || ''],
      ['考试', A.exam.name],
      ['科目', subjectName(A.exam.subjectId)],
      ['总分', s.total],
      ['班级排名', s.rank],
      ['得分率', (s.total / tplTotal * 100).toFixed(0) + '%'],
      ['', ''],
      ['一、逐题评价', ''],
      ['题号', '题型', '知识点', '满分', '得分', '得分率', '失分', '班平得分率', '是否优于班平', '逐题评价'],
      ...s.items.map(i => [i.q.qid, i.q.type, i.q.knowledge, i.full, i.score, (i.rate * 100).toFixed(0) + '%', i.loss, (i.classAvgRate * 100).toFixed(0) + '%', i.diff >= 0.05 ? '优于' : i.diff <= -0.05 ? '低于' : '持平', commentsFor(i)]),
      ['', ''],
      ['二、优势点', s.strong.length ? s.strong.map(i => i.q.qid + ' ' + i.q.knowledge + '（得分率' + (i.rate * 100).toFixed(0) + '%）').join('；') : '暂无显著优势点'],
      ['三、薄弱点', s.weak.length ? s.weak.map(i => i.q.qid + ' ' + i.q.knowledge + '（得分率' + (i.rate * 100).toFixed(0) + '%）').join('；') : '无明显薄弱点'],
      ['', ''],
      ['四、整体评价', overallComment(s, A)],
      ['', ''],
      ['五、复习建议', ''],
    ];
    s.advice.forEach(a => rows.push(['', a]));
    rows.push(['', ''], ['免责声明', DISCLAIMER]);
    wb.Sheets[sheetName] = aoaSheet(sheetName, rows, [18, 16, 20, 10, 10, 10, 10, 12, 14, 52]);
  });
  XLSX.writeFile(wb, '学生个人评价报告-' + A.exam.name + '.xlsx');
  toast('已导出学生个人评价报告，共 ' + A.std.length + ' 份');
});

/* ============================================================
 *  数据备份 / 恢复
 * ========================================================== */
$('#btnBackup').addEventListener('click', () => {
  const wb = XLSX.utils.book_new();
  wb.SheetNames.push('templates');
  const tRows = [['id', '名称', '科目', '题目数', '满分']];
  state.templates.forEach(t => t.questions.forEach(q => tRows.push([t.id, t.name, t.subjectId, q.qid + '|' + q.type + '|' + q.knowledge + '|' + q.fullMark])));
  wb.Sheets['templates'] = XLSX.utils.aoa_to_sheet(tRows);
  const eRows = [['考试记录（题目清单在左侧模板表）']];
  state.exams.forEach(e => eRows.push([e.id, e.name, e.subjectId, e.templateId, e.date, e.students.length + '人']));
  const stuSheet = [['考试id', '考试名', '学号', '姓名', '小题得分JSON']];
  state.exams.forEach(e => {
    (e.students || []).forEach(s => {
      stuSheet.push([e.id, e.name, s.no || '', s.name, JSON.stringify(s.scores || {})]);
    });
  });
  wb.SheetNames.push('scores');
  wb.Sheets['scores'] = XLSX.utils.aoa_to_sheet(stuSheet);
  XLSX.writeFile(wb, '智析阅卷-数据备份-' + new Date().toISOString().slice(0, 10) + '.xlsx');
  toast('已导出数据备份 Excel（含全部考试成绩）');
});
$('#btnRestore').addEventListener('click', () => $('#restoreFile').click());
$('#restoreFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (!confirm('恢复数据将覆盖当前模板与考试，是否继续？')) return;
  try {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const stu = wb.Sheets['scores'];
    if (!stu) { toast('未找到成绩工作表', 'err'); return; }
    const rows = XLSX.utils.sheet_to_json(stu, { header: 1 });
    const map = {};
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[0]) continue;
      const eid = String(row[0]);
      (map[eid] = map[eid] || []).push({ id: uid(), no: row[2] || '', name: row[3] || '学生', scores: JSON.parse(row[4] || '{}') });
    }
    let n = 0;
    state.exams.forEach(e => { if (map[e.id]) { e.students = map[e.id]; n++; } });
    store(DB.exams, state.exams);
    renderHome(); renderExams();
    if (state.currentExamId) renderAnalysisPage();
    toast('恢复完成，已更新 ' + n + ' 场考试的成绩');
  } catch (err) { toast('恢复失败：' + err.message, 'err'); }
});

/* ---------- 清除全部数据 ---------- */
$('#btnClearAll').addEventListener('click', async () => {
  const sure = confirm('确定要清除本浏览器中的全部数据吗？\n（模板、考试、学生成绩、归档文件将全部删除，且无法找回）');
  if (!sure) return;
  const sure2 = confirm('此操作不可撤销！\n建议先点击"备份数据"导出存档。\n仍要彻底清除吗？');
  if (!sure2) return;
  try {
    // 清除 localStorage 里的应用数据
    Object.values(DB).forEach(k => localStorage.removeItem(k));
    try {
      const db = await idb.open();
      if (db) {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').clear();
        await new Promise(r => { tx.oncomplete = r; tx.onerror = r; });
      }
    } catch (e) { /* 忽略归档清除失败 */ }
    toast('已清除全部数据，正在刷新…', 'ok');
    setTimeout(() => location.reload(), 600);
  } catch (err) { toast('清除失败：' + err.message, 'err'); }
});

/* ---------- HTML 转义 ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 主题/杂项 ---------- */

/* ============================================================
 *  智能识别（自动组卷）：上传试卷/答案 → 提取文字 → 识别题号/分值/题型
 * ========================================================== */
const SMART = { paperFile: null, answerFile: null, questions: [], scanned: false };
const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function openSmart() {
  fillSubjects($('#smartSubject'), '');
  $('#smartName').value = '';
  $('#smartPaperMeta').textContent = '仅支持文字版 PDF / Word(.docx)；扫描版 PDF 无法识别，请勿上传';
  $('#smartAnswerMeta').textContent = '可选';
  $('#smartPaper').value = ''; $('#smartAnswer').value = '';
  SMART.paperFile = null; SMART.answerFile = null; SMART.questions = [];
  $('#btnSmartRun').disabled = true;
  $('#btnSmartToTpl').disabled = true;
  $('#smartSummary').textContent = '';
  $('#smartProgress').classList.add('hidden');
  $('#smartModal').classList.remove('hidden');
}
$('#btnSmart').addEventListener('click', openSmart);

$('#smartPaper').addEventListener('change', (e) => {
  SMART.paperFile = e.target.files[0] || null;
  $('#smartPaperMeta').textContent = SMART.paperFile ? '已选：' + SMART.paperFile.name : '请选择试卷';
  $('#btnSmartRun').disabled = !SMART.paperFile;
  if (SMART.paperFile && !$('#smartName').value.trim()) {
    $('#smartName').value = SMART.paperFile.name.replace(/\.[^.]+$/, '');
  }
});
$('#smartAnswer').addEventListener('change', (e) => {
  SMART.answerFile = e.target.files[0] || null;
  $('#smartAnswerMeta').textContent = SMART.answerFile ? '已选：' + SMART.answerFile.name : '可选';
});

$('#btnSmartRun').addEventListener('click', async () => {
  if (!SMART.paperFile) return;
  const prog = $('#smartProgress');
  prog.classList.remove('hidden');
  $('#btnSmartRun').disabled = true;
  $('#smartSummary').textContent = '';
  try {
    prog.textContent = '正在提取试卷文字…';
    let paperText = await extractText(SMART.paperFile);
    SMART.scanned = false;
    if (paperText.replace(/\s/g, '').length < 60) {
      throw new Error('该试卷是扫描版 PDF（无文字层）。本系统已停止支持扫描件识别，请改为上传文字版 PDF 或 Word(.docx)。');
    }
    let questions = parsePaper(paperText);
    // 答案辅助校准分值
    if (SMART.answerFile) {
      let aText = await extractText(SMART.answerFile);
      const withPoints = parsePaper(aText, questions.length);
      questions = mergeByPoints(questions, withPoints);
    }
    SMART.questions = questions;
    autoKnowledge(SMART.questions, $('#smartSubject').value || SUBJECTS[0].id);
    const withP = questions.filter(q => q.fullMark > 0).length;
    prog.classList.add('hidden');
    $('#smartSummary').innerHTML = `识别完成：共 <b>${questions.length}</b> 道小题，其中 <b>${withP}</b> 道已识别到分值，
      <b>${questions.length - withP}</b> 道需在下一步补分值。`;
    $('#btnSmartToTpl').disabled = questions.length === 0;
  } catch (err) {
    prog.textContent = '';
    $('#smartSummary').innerHTML = '<span style="color:var(--danger)">识别失败：' + esc(err.message) + '</span>';
  } finally {
    $('#btnSmartRun').disabled = false;
  }
});

$('#btnSmartToTpl').addEventListener('click', () => {
  if (!SMART.questions.length) return;
  const name = $('#smartName').value.trim() || '智能识别模板';
  const subjectId = $('#smartSubject').value || SUBJECTS[0].id;
  openTplModalWithQ(name, subjectId, SMART.questions);
  $('#smartModal').classList.add('hidden');
});
function openTplModalWithQ(name, subjectId, questions) {
  openTplModal(null);
  $('#tplName').value = name;
  $('#tplSubject').value = subjectId;
  const body = $('#qTable tbody'); body.innerHTML = '';
  (questions.length ? questions : []).forEach(q => addQuestionRow({
    qid: q.qid, type: q.type, knowledge: q.knowledge || '', fullMark: q.fullMark || '',
  }));
  if (!questions.length) for (let i = 0; i < 3; i++) addQuestionRow();
}

/* --- 文字提取 --- */

// docx 兜底提取：不依赖外部 mammoth CDN，直接解析 ZIP 中 word/document.xml 抽文字
async function extractDocxXml(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {           // End Of Central Directory
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const cdOffset = dv.getUint32(eocd + 16, true);
  const cdCount = dv.getUint16(eocd + 10, true);
  let target = null, off = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true);
    const elen = dv.getUint16(off + 30, true);
    const clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    let name = '';
    for (let k = 0; k < nlen; k++) name += String.fromCharCode(u8[off + 46 + k]);
    const dataOff = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    if (name === 'word/document.xml') {
      target = { method, csize, off: dataOff };
      break;
    }
    off += 46 + nlen + elen + clen;
  }
  if (!target) return null;
  const comp = u8.subarray(target.off, target.off + target.csize);
  if (target.method === 0) return new TextDecoder('utf-8').decode(comp);
  // deflate-raw 压缩：用浏览器原生 DecompressionStream（无需第三方库）
  const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const decBuf = await new Response(stream).arrayBuffer();
  return new TextDecoder('utf-8').decode(decBuf);
}
function textFromWml(xml) {
  const t = xml.replace(/<w:p[^>]*>/g, '\n').replace(/<w:tab[^>]*>/g, '\t').replace(/<w:br[^>]*>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return t.replace(/\u00a0/g, ' ');
}
async function extractText(file) {
  const name = (file.name || '').toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.docx') || /wordprocessing/.test(file.type)) {
    // 优先内置 ZIP 解析：保证段落内留换行、题号可被规则识别，且不依赖外部 CDN。
    // （此前依赖 mammoth 的 innerText，会把段落挤成单行导致 parsePaper 识别不到任何题目）
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const xml = await extractDocxXml(buf);
        if (xml) {
          const t = textFromWml(xml);
          if (t.replace(/\s/g, '').length) return t;
        }
      } catch (e) { /* 继续走兜底 */ }
    }
    if (typeof mammoth !== 'undefined') {
      try {
        const res = await mammoth.convertToHtml({ arrayBuffer: buf });
        const html = (res && res.value) || '';
        if (html) {
          // 确定性转换：块级/表格/换行标签→换行，而不是读 innerText。
          // innerText 在不同浏览器下会把整份试卷压成单行，导致 parsePaper 识别不到任何题号。
          const t = html.replace(/<\/(p|div|h[1-6]|li|td|tr|table|figure|figcaption)>/gi, '\n')
            .replace(/<br[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n');
          if (t.replace(/\s/g, '').length) return t;
        }
      } catch (e) { /* 继续走兜底 */ }
    }
    throw new Error('.docx 文字提取失败，请尝试另存为 PDF 后再识别');
  }
  if (name.endsWith('.doc') || /msword/.test(file.type)) {
    const s = decodeDocText(new Uint8Array(buf));
    if (s.replace(/\s/g, '').length < 40) throw new Error('.doc 为旧版格式，浏览器无法可靠提取文字，建议另存为 .docx 或 PDF 后再识别');
    return s;
  }
  if (name.endsWith('.pdf') || /pdf/.test(file.type)) {
    return await extractPdfText(buf);
  }
  throw new Error('暂不支持该文件类型，请上传 PDF 或 Word');
}
function decodeDocText(u8) {
  let out = '';
  try { out = new TextDecoder('utf-16le').decode(u8); } catch (e) { }
  let filtered = '';
  for (const ch of out) {
    const c = ch.codePointAt(0);
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x30 && c <= 0x7e) || (c >= 0x3001 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef) || c === 0x0a || c === 0x0d) filtered += ch;
  }
  return filtered;
}
async function extractPdfText(buf) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    let lastY = null;
    for (const it of tc.items) {
      if (it.transform && lastY != null && Math.abs(it.transform[5] - lastY) > 3.5) text += '\n';
      text += (it.str || '');
      lastY = it.transform ? it.transform[5] : lastY;
      if ((it.str || '').match(/[\s。；?!，,、：:]$/)) text += '\n';
    }
    text += '\n';
  }
  return text;
}

/* --- OCR 兜底（扫描件）--- */
async function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) { res(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('OCR 库加载失败（需联网）'));
    document.head.appendChild(s);
  });
}
/* --- 双栏版式重排：从句法树收集带坐标的文本行 --- */
function collectOcrLines(data) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n.lines)) {
      for (const L of n.lines) {
        if (L && L.text && L.bbox) out.push({ text: String(L.text).trim(), bbox: L.bbox, x0: L.bbox.x0, y0: L.bbox.y0, x1: L.bbox.x1, y1: L.bbox.y1 });
      }
      return; // line 已含完整文本，不再深入取字（避免重复）
    }
    for (const k of Object.keys(n)) walk(n[k]);
  };
  walk(data && data.blocks);
  return out;
}
/* 按坐标把 OCR 输出整理成正确阅读顺序：
 * - 双栏版（试卷/报刊常见）：通栏+左栏自上而下，再右栏自上而下，避免题号跨栏交错；
 * - 单栏版：整体按纵向 y 排序即可（比引擎原始顺序更稳）。
 * 列判定：正文块按中心 x 对半分成左右两簇，若两簇中心间距明显（>0.2 页宽）则视为双栏。 */
function reorderOcrLines(lines, pageW) {
  const norm = (lines || []).filter(L => L && L.text);
  if (norm.length < 2) return norm.map(L => L.text);
  const byY = (a, b) => a.y0 - b.y0;
  const cx = (L) => (L.x0 + L.x1) / 2;
  const full = [], body = [];
  for (const L of norm) { if ((L.x1 - L.x0) > pageW * 0.55) full.push(L); else body.push(L); }
  if (!body.length) return norm.slice().sort(byY).map(L => L.text);
  const centers = body.map(cx).sort((a, b) => a - b);
  const split = centers[Math.floor(centers.length / 2)];   // 中心中位数
  const leftO = [], rightO = [];
  for (const L of body) { (cx(L) <= split ? leftO : rightO).push(L); }
  const avg = (arr) => arr.length ? arr.reduce((s, L) => s + cx(L), 0) / arr.length : 0;
  const twoCol = leftO.length && rightO.length && (avg(rightO) - avg(leftO)) > pageW * 0.2;
  if (!twoCol) return norm.slice().sort(byY).map(L => L.text);   // 单栏或无法判定
  leftO.push(...full);          // 通栏标题并入左栏顺序（按 y 归位）
  leftO.sort(byY); rightO.sort(byY);
  return [...leftO.map(L => L.text), ...rightO.map(L => L.text)];
}
async function ocrPdf(buf, onProgress) {
  await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = Math.min(pdf.numPages, 8);
  const worker = await Tesseract.createWorker('chi_sim+eng', 1, {
    logger: () => { },
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
  });
  let out = '';
  for (let p = 1; p <= pages; p++) {
    onProgress(`OCR 识别第 ${p}/${pages} 页（扫描件较慢，请耐心等待）…`);
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = viewport.width; c.height = viewport.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
    const r = await worker.recognize(c);
    // 用坐标把“双栏版”按左栏→右栏重排，避免题号被跨栏交错打乱；无线级数据时回退原始文本
    let pageText = r.data.text;
    const lines = collectOcrLines(r.data);
    if (lines.length) pageText = reorderOcrLines(lines, viewport.width).join('\n');
    out += pageText + '\n';
  }
  await worker.terminate();
  return out;
}

/* --- 高中全科目知识点库：识别时用于自动标注每题对应知识点 --- */
const KNOWLEDGE_MAP = {
  chinese: [
    { name: '现代文阅读', kws: ['现代文', '散文', '小说', '议论文', '说明文', '记叙文', '主旨', '表现手法', '行文思路'] },
    { name: '文言文阅读', kws: ['文言文', '虚词', '实词', '翻译', '翻译成现代汉语', '断句', '词类活用', '一词多义', '通假字', '文言', '画波浪线'] },
    { name: '古诗词鉴赏', kws: ['诗歌鉴赏', '古诗', '词作', '意象', '意境', '炼字', '对仗', '抒情手法', '借景抒情', '托物言志', '赏析', '理解和赏析'] },
    { name: '名句默写', kws: ['名句', '默写', '背诵', '古诗文填空', '空缺部分'] },
    { name: '语言文字运用', kws: ['成语', '病句', '语序', '连贯', '字音', '字形', '修辞', '得体', '仿写'] },
    { name: '作文', kws: ['作文', '写作', '材料作文', '命题作文', '议论文写作', '立意'] },
    { name: '文学与文化常识', kws: ['文学常识', '名著', '文化常识', '作者'] },
  ],
  math: [
    { name: '集合与常用逻辑', kws: ['集合', '子集', '并集', '交集', '补集', '充分条件', '必要条件', '充要条件', '命题', '量词'] },
    { name: '函数与导数', kws: ['函数', '单调性', '奇偶性', '周期性', '值域', '定义域', '极值', '最值', '导数', '切线', '求导'] },
    { name: '三角函数与解三角形', kws: ['三角函数', '正弦', '余弦', '正切', '弧度', '角', '解三角形', '正弦定理', '余弦定理', '面积公式', 'sin', 'cos', 'tan'] },
    { name: '数列', kws: ['数列', '等差数列', '等比数列', '通项', '前n项和', '求和', '递推'] },
    { name: '不等式', kws: ['不等式', '基本不等式', '均值', '线性规划', '绝对值不等式', '一元二次不等式'] },
    { name: '立体几何', kws: ['立体', '空间几何', '三视图', '体积', '表面积', '直线与平面', '二面角', '棱柱', '棱锥', '圆锥', '球面', '线面'] },
    { name: '解析几何与圆锥曲线', kws: ['解析几何', '椭圆', '双曲线', '抛物线', '圆', '离心率', '焦点', '准线', '直线方程', '弦长'] },
    { name: '平面向量', kws: ['向量', '平面向量', '数量积', '共线', '夹角', '模长'] },
    { name: '复数', kws: ['复数', '虚数', '虚部', '实部', '模', '共轭', '复平面'] },
    { name: '概率与统计', kws: ['概率', '统计', '随机变量', '期望', '方差', '标准差', '频率分布', '直方图', '样本', '正态分布'] },
    { name: '计数原理与排列组合', kws: ['排列', '组合', '二项式', '计数原理', '分步', '分类'] },
    { name: '参数方程与极坐标', kws: ['参数方程', '极坐标', '参数'] },
  ],
  english: [
    { name: '阅读理解', kws: ['阅读理解', '文章', '主旨大意', '细节理解', '推理判断', '词义猜测', 'passage'] },
    { name: '完形填空', kws: ['完形填空', 'cloze'] },
    { name: '语法填空', kws: ['语法填空', '时态', '语态', '主谓一致', '非谓语', '固定搭配', '词性变化'] },
    { name: '书面表达', kws: ['书面表达', '写作', '作文', 'letter', 'survey', 'application'] },
    { name: '短文改错', kws: ['短文改错', '改错'] },
    { name: '听力', kws: ['听力', 'listening', 'dialogue'] },
  ],
  japanese: [
    { name: '阅读理解', kws: ['読解', '阅读', '文章', '理解', 'グラフ'] },
    { name: '语法', kws: ['助词', '格助词', '动词活用', '敬语', 'て形', 'ない形', 'た形', '接续', '语法'] },
    { name: '词汇', kws: ['词汇', '单词', '汉字', '读音', '外来语'] },
    { name: '书面表达', kws: ['写作', '作文', '手纸', 'メール'] },
  ],
  physics: [
    { name: '力与牛顿运动定律', kws: ['牛顿', '受力分析', '摩擦力', '弹力', '重力', '合力', '滑动摩擦', '平衡力', '作用力'] },
    { name: '直线运动', kws: ['匀变速', '自由落体', '自由下落', '初速度', '末速度', '匀加速', '位移', '速度', '平均速度', 'v-t图', 'x-t图', '路程'] },
    { name: '曲线运动与抛体', kws: ['平抛', '抛体', '曲线运动', '圆周运动', '向心加速度', '向心力', '离心'] },
    { name: '万有引力与航天', kws: ['万有引力', '卫星', '绕地球', '近地', '航天', '宇宙速度', '开普勒', '天体', '轨道', '行星运动', '地球同步'] },
    { name: '功和能', kws: ['功', '功率', '动能', '动能定理', '势能', '机械能', '机械能守恒', '能量守恒', '功与能'] },
    { name: '动量', kws: ['动量', '冲量', '碰撞', '动量守恒', '反冲'] },
    { name: '静电场', kws: ['电场', '电势', '场强', '电场线', '等势面', '库仑', '电容', '静电', '电荷'] },
    { name: '恒定电流', kws: ['欧姆定律', '电阻', '电流', '电压', '电功率', '闭合电路', '内阻', '串联', '并联', '焦耳'] },
    { name: '磁场', kws: ['磁场', '磁感应强度', '安培力', '洛伦兹力', '洛伦兹', '磁感线', '通电导线'] },
    { name: '电磁感应', kws: ['电磁感应', '楞次定律', '法拉第', '感应电动势', '感应电流', '导体棒', '自感'] },
    { name: '交变电流', kws: ['交变电流', '交流', '变压器', '正弦式', '有效值', '瞬时值', '周期'] },
    { name: '分子动理论与热学', kws: ['分子动理论', '内能', '热量', '热力学', '理想气体', '压强', '温度', '体积', '气体'] },
    { name: '机械振动与机械波', kws: ['振动', '机械波', '波长', '频率', '周期', '振幅', '简谐', '波的传播'] },
    { name: '光', kws: ['折射', '反射', '干涉', '衍射', '全反射', '透镜', '光的反射', '光的折射', '光的干涉', '光的衍射', '光纤', '激光', '偏振', '棱镜'] },
    { name: '近代物理', kws: ['原子', '电子', '能级', '光电效应', '放射性', '核反应', '衰变', '质能', '光子'] },
  ],
  chem: [
    { name: '物质的量与化学计量', kws: ['物质的量', '摩尔', '阿伏伽德罗', '摩尔质量', '气体摩尔体积', '物质的量浓度', '质量分数'] },
    { name: '化学实验基础', kws: ['实验', '试剂', '分液', '蒸馏', '萃取', '过滤', '结晶', '容量瓶', '滴定管', '加热', '仪器'] },
    { name: '离子反应', kws: ['离子反应', '离子方程式', '电解质', '非电解质', '离子共存', '水解'] },
    { name: '氧化还原反应', kws: ['氧化还原', '氧化剂', '还原剂', '化合价', '得失电子', '转移电子'] },
    { name: '元素周期律与物质结构', kws: ['元素周期', '原子序数', '周期表', '金属性', '非金属性', '原子结构', '化学键', '共价键', '离子键', '氢键', '电子式'] },
    { name: '非金属及其化合物', kws: ['氯', '硫', '氮', '硅', '硫酸', '硝酸', '氨', '二氧化硫', '氯化氢', '二氧化氮', '亚硫酸'] },
    { name: '金属及其化合物', kws: ['钠', '镁', '铝', '铁', '铜', '氢氧化钠', '氧化铝', '碳酸钠', '铝热', '金属材料', '合金'] },
    { name: '有机化学基础', kws: ['有机物', '烃', '烷烃', '烯烃', '炔烃', '苯', '乙醇', '乙酸', '酯', '醛', '官能团', '同分异构', '加成', '取代', '消去', '聚合'] },
    { name: '化学反应速率与化学平衡', kws: ['反应速率', '化学平衡', '平衡常数', '勒夏特列', '平衡移动', '转化率', '催化剂'] },
    { name: '水溶液与电离平衡', kws: ['电离', '弱电解质', '水的电离', 'ph', '盐类水解', '沉淀溶解', '溶度积', '离子浓度'] },
    { name: '电化学', kws: ['原电池', '电解', '电极', '正极', '负极', '阳极', '阴极', '电镀', '燃料电池', '电解池'] },
    { name: '化学计算', kws: ['守恒', '差量法', '关系式', '产率', '纯度'] },
  ],
  bio: [
    { name: '细胞的分子组成', kws: ['蛋白质', '氨基酸', '核酸', '核苷酸', '糖类', '脂质', '多肽', '肽键'] },
    { name: '细胞结构与功能', kws: ['细胞膜', '细胞核', '细胞器', '线粒体', '叶绿体', '核糖体', '内质网', '高尔基体', '细胞壁', '原生质'] },
    { name: '酶与ATP', kws: ['酶', 'atp', 'adp', '催化', '活性'] },
    { name: '细胞代谢', kws: ['光合作用', '呼吸作用', '光反应', '暗反应', '胞内运输', '有机物', '光能'] },
    { name: '细胞增殖', kws: ['有丝分裂', '减数分裂', '染色体', '姐妹染色单体', '细胞周期', '染色体数目'] },
    { name: '遗传规律', kws: ['遗传', '孟德尔', '分离定律', '自由组合', '伴性遗传', '基因型', '表现型', '等位基因'] },
    { name: '基因与变异', kws: ['基因突变', '基因重组', '染色体变异', '变异', '基因', 'dna复制', 'dna分子'] },
    { name: '基因表达', kws: ['转录', '翻译', '中心法则', 'mrna', 'trna', '密码子', '碱基'] },
    { name: '生命活动调节', kws: ['神经调节', '体液调节', '激素', '反射弧', '突触', '免疫', '血糖', '甲状腺', '生长素', '兴奋'] },
    { name: '稳态与内环境', kws: ['内环境', '稳态', '渗透压', '体温', '水盐平衡', '酸碱'] },
    { name: '种群与群落', kws: ['种群', '群落', '种群密度', '出生率', '死亡率', '种间关系', '捕食', '竞争', '演替'] },
    { name: '生态系统', kws: ['生态系统', '食物链', '食物网', '能量流动', '物质循环', '碳循环', '生态位', '生物多样性'] },
    { name: '生物技术与工程', kws: ['基因工程', '细胞工程', '组织培养', '发酵工程', '单克隆', '限制酶', '质粒', '核酸疫苗'] },
  ],
  history: [
    { name: '中国古代政治制度', kws: ['分封制', '宗法制', '中央集权', '郡县制', '三省六部', '科举', '军机处', '行省', '专制主义', '监察'] },
    { name: '中国古代经济', kws: ['小农经济', '重农抑商', '均田', '租庸调', '井田制', '丝绸之路', '商品经济发展', '商业', '资本主义萌芽'] },
    { name: '中国古代文化', kws: ['百家争鸣', '儒家', '孔子', '孟子', '荀子', '墨家', '法家', '道家', '唐诗宋词', '四大发明', '书法', '汉赋'] },
    { name: '近代前期抗争与探索', kws: ['鸦片战争', '太平天国', '洋务运动', '戊戌变法', '辛亥革命', '新文化运动', '甲午战争', '戊戌'] },
    { name: '新民主主义革命', kws: ['五四运动', '中国共产党', '长征', '南昌起义', '井冈山', '抗战', '日本侵华', '解放战争', '土地革命'] },
    { name: '中国现代史', kws: ['三大改造', '五年计划', '改革开放', '经济特区', '一国两制', '十一届三中全会', '家庭联产承包'] },
    { name: '古代希腊罗马', kws: ['雅典', '民主政治', '罗马法', '城邦', '公民', '梭伦', '伯里克利'] },
    { name: '西方近代思想', kws: ['文艺复兴', '宗教改革', '启蒙运动', '人文主义', '启蒙思想', '伏尔泰', '卢梭', '孟德斯鸠', '理性'] },
    { name: '西方资本主义发展', kws: ['工业革命', '第一次工业革命', '第二次工业革命', '垄断', '世界市场', '经济全球化', '殖民地'] },
    { name: '世界近现代政治', kws: ['资产阶级革命', '英国', '美国独立战争', '法国大革命', '第一次世界大战', '第二次世界大战', '冷战', '两极格局', '凡尔赛'] },
    { name: '苏联社会主义', kws: ['十月革命', '苏联', '斯大林', '计划经济', '新经济政策', '集体农庄'] },
  ],
  geo: [
    { name: '地球与地图', kws: ['经纬度', '经线', '纬线', '经纬', '纬度', '经度', '比例尺', '等高线', '时区', '日界线', '地图', '图例', '方向判读'] },
    { name: '地球运动', kws: ['自转', '公转', '昼夜', '正午太阳高度', '太阳高度', '日影', '四季', '五带', '太阳直射', '极昼', '极夜', '昼夜长短', '黄赤交角', '地转偏向'] },
    { name: '大气环境', kws: ['大气', '气压', '风', '锋面', '气旋', '反气旋', '季风', '气候', '降水', '海陆热力', '盛行风', '水汽', '比湿', '逆温', '逆湿', '低压槽', '高压脊', '对流'] },
    { name: '水循环与洋流', kws: ['水循环', '洋流', '河流', '湖泊', '冰川', '径流', '补给', '汛期', '水文', '水量', '含沙量', '支流'] },
    { name: '地质作用与地貌', kws: ['地质', '板块', '内力作用', '外力作用', '侵蚀', '沉积', '地质构造', '褶皱', '断层', '地貌', '山地', '河谷', '堆积', '搬运', '风化', '岩层', '化石', '地壳', '地幔', '地核', '岩石圈', '地质年代', '剖面'] },
    { name: '自然资源与自然灾害', kws: ['自然资源', '能源', '矿产', '台风', '地震', '滑坡', '泥石流', '旱涝', '灾害'] },
    { name: '人口与城市', kws: ['人口', '城市化', '聚落', '城市', '人口迁移', '老龄化', '区位选择'] },
    { name: '农业地域', kws: ['农业', '种植业', '畜牧业', '水稻', '小麦', '商品粮', '农业地域', '灌溉'] },
    { name: '工业区位', kws: ['工业', '区位', '钢铁', '电子', '产业集聚', '产业转移', '布局'] },
    { name: '交通与商业', kws: ['交通', '运输', '港口', '铁路', '枢纽', '商业网点', '贸易'] },
    { name: '区域可持续发展', kws: ['可持续发展', '生态', '环境问题', '水土流失', '荒漠化', '湿地', '全球变暖', '区域'] },
    { name: '等值线判读', kws: ['等值线', '等温线', '等压线', '等降水量', '等高线判读', '等深线'] },
  ],
  politics: [
    { name: '经济生活', kws: ['价格', '价值', '供求', '供给', '需求', '消费', '市场经济', '宏观调控', '财政', '货币', '汇率', '通货膨胀'] },
    { name: '企业与劳动者', kws: ['企业', '公司', '劳动者', '就业', '分配', '按劳分配', '收入', '效率与公平'] },
    { name: '政治生活', kws: ['人民代表大会', '政府', '民主', '公民', '权利与义务', '依法行政', '人民民主', '自治'] },
    { name: '中国共产党', kws: ['中国共产党', '执政', '依法行政', '领导核心', '从严治党', '党的领导'] },
    { name: '国际政治经济', kws: ['国际', '联合国', '外交', '主权', '全球化', '命运共同体', '世界', '和平与发展'] },
    { name: '哲学(唯物论与认识论)', kws: ['唯物', '意识', '物质', '实践', '认识', '真理', '规律', '客观实在'] },
    { name: '哲学(唯物辩证法)', kws: ['辩证法', '矛盾', '对立统一', '发展', '联系', '量变', '质变', '否定之否定'] },
    { name: '文化生活', kws: ['文化', '民族精神', '传统文化', '核心价值观', '中华文化', '文化创新', '继承'] },
  ],
};
/* 细粒度知识点：在板块（如现代文阅读）内部再区分具体知识点。
   板块头只负责收敛到大类；细分靠题目本身特征词，命中不够确定时退回大类，
   避免在不确定时给出一个可能错得很具体的标签。 */
const KNOWLEDGE_FINE = {
  chinese: {
    '现代文阅读': [
      { name: '信息筛选与整合', kws: ['根据材料内容', '正确的一项是', '不正确的一项是', '说法正确的是', '说法不正确', '下列选项', '下列表述', '理解和分析', '不属于', '相关内容', '对材料的', '可以体现', '印证', '推断', '对文章'] },
      { name: '论证与分析', kws: ['论证', '论点', '论据', '论证方法', '论证结构', '论证思路', '层层递进', '承上启下', '段落论证'] },
      { name: '行文思路', kws: ['行文思路', '梳理', '概括', '简述', '要点', '层次', '脉络', '顺序', '结构安排', '整体结构', '思路'] },
      { name: '词语理解', kws: ['加点词语', '词语的含义', '理解文中加点', '这个词', '词语在文中', '指什么', '含义是什么'] },
      { name: '语句赏析', kws: ['赏析', '品味', '妙处', '精妙之处', '这句话', '画线句', '句子', '表达效果', '富有表现力', '描写有何', '好在', '好处'] },
      { name: '标题作用', kws: ['标题', '题目的', '以……为题', '可否换成', '为什么以', '标题作用', '能否', '换'] },
      { name: '人物形象', kws: ['人物形象', '塑造了', '性格', '心理', '品质', '形象特点', '刻画', '主人公', '写出人物', '人物描写'] },
      { name: '作用与效果', kws: ['作用', '效果', '铺垫', '照应', '呼应', '伏笔', '引出下文', '开头段', '结尾段', '安排', '在文中'] },
      { name: '表现手法', kws: ['表现手法', '修辞', '象征', '对比', '衬托', '反衬', '虚实', '反复', '排比', '设问', '比喻', '拟人', '白描'] },
      { name: '主旨与探究', kws: ['主旨', '主题', '探究', '启示', '感悟', '谈理解', '联系全文', '结合全文', '情感', '作者意图'] },
    ],
    '文言文阅读': [
      { name: '文言实词', kws: ['加点词', '实词', '词义', '解释相同', '加点词语', '词的解释', '不正确的一项', '加点的词'] },
      { name: '文言虚词', kws: ['虚词', '意义和用法', '加点虚词', '区别', '不同的用法'] },
      { name: '文言断句', kws: ['断句', '画波浪线', '划分句子', '标出', '节奏'] },
      { name: '文言翻译', kws: ['翻译', '成现代汉语', '译成', '译文', '翻译句子', '翻译文中'] },
      { name: '内容理解与概括', kws: ['概括', '理解', '简要', '内容', '措施', '原因', '哪些', '为什么', '下列说法', '下列关于原文', '解说', '具体措施'] },
      { name: '词类活用与句式', kws: ['词类活用', '古今异义', '通假', '文言句式', '省略', '被动', '判断句', '活用'] },
    ],
    '古诗词鉴赏': [
      { name: '诗歌炼字', kws: ['炼字', '哪个字', '用得最妙', '字眼', '点睛', '一字', '动词', '用得好'] },
      { name: '诗歌情感', kws: ['情感', '思想感情', '抒发', '表达的情感', '怎样的感情', '内心', '愁', '主题'] },
      { name: '诗歌手法', kws: ['手法', '借景抒情', '虚实', '衬托', '用典', '象征', '白描', '烘托', '渲染', '动静', '对比'] },
      { name: '诗歌形象', kws: ['形象', '意象', '画面', '景象', '意境', '描绘', '景物'] },
      { name: '诗歌语言', kws: ['语言风格', '语言', '诗眼', '用词', '含蓄', '洗练', '沉郁', '豪放'] },
    ],
    '名句默写': [
      { name: '名篇名句默写', kws: ['补写出', '空缺部分', '默写', '句子', '填空'] },
    ],
    '语言文字运用': [
      { name: '词语运用', kws: ['词语', '成语', '填入', '括号内', '恰当的一项', '使用正确', '运用恰', '具体语境', '词语使用'] },
      { name: '病句修改', kws: ['病句', '表达不当', '修改', '有语病', '序号', '准确流畅', '简明'] },
      { name: '句序与衔接', kws: ['衔接', '连贯', '语序', '排列', '顺序', '复位', '插入'] },
      { name: '语言表达得体', kws: ['得体', '应用文', '邀请', '通知', '启事', '称谓', '口语', '书面语', '委婉'] },
      { name: '句式仿写与概括', kws: ['仿写', '仿照', '小标题', '拟写', '缩写', '压缩', '下定义', '概括', '转述', '改写'] },
      { name: '图文转换', kws: ['图表', '徽标', '漫画', '图片', '思维导图', '示意'] },
    ],
    '作文': [
      { name: '材料作文·立意', kws: ['阅读下面的材料', '写作', '谈谈', '认识', '感悟', '根据要求', '自拟题目', '议论文'] },
    ],
  },
};
const normK = (s = '') => String(s).toLowerCase().replace(/[\s（）()：:，,。.、;；'"“”!！?？\-—]/g, '');
/* 依据题目文字自动标注知识点。
   打分规则：
   - 关键词越长越具体，得分越高（上限 5）；
   - 同一关键词在本科目多个知识点中反复出现（跨类通用词，如周期/依法行政）时降权；
   - 题干命中优先，仅材料命中的降权（材料常为大段背景，含通用词多，易造成误判）；
   - 仅命中 1 个关键词时打折，且需达到置信阈值，不足则归为「综合」，减少错标。 */
function autoKnowledge(questions, subjectId) {
  const list = KNOWLEDGE_MAP[subjectId] || [];
  const fineAll = KNOWLEDGE_FINE[subjectId] || {};
  const normed = list.map(kp => ({ name: kp.name, kws: (kp.kws || []).map(normK).filter(k => k.length >= 2) }));
  const names = new Set(normed.map(x => x.name));
  const kwFreq = {};
  for (const { kws } of normed) for (const k of kws) kwFreq[k] = (kwFreq[k] || 0) + 1;
  const fineNormed = {};
  for (const sec in fineAll) fineNormed[sec] = fineAll[sec].map(kp => ({ name: kp.name, kws: (kp.kws || []).map(normK).filter(k => k.length >= 2) }));

  // 对一组知识点打分（板块级与细粒度共用），返回 {best, bs}
  const scoreEntries = (partsT, matT, kwsList) => {
    let best = '', bs = 0;
    for (const { name, kws } of kwsList) {
      const cell = [];
      for (const k of kws) { const inParts = partsT.includes(k); if (inParts || matT.includes(k)) cell.push({ k, inParts }); }
      if (!cell.length) continue;
      const maximal = cell.filter((c, i) => !cell.some((d, j) => j !== i && d.k.length > c.k.length && d.k.includes(c.k)));
      let sc = 0;
      for (const { k, inParts } of maximal) sc += Math.min(k.length, 5) * (kwFreq[k] > 1 ? 0.5 : 1) * (inParts ? 1 : 0.6);
      const finalScore = sc * (maximal.length >= 2 ? 1 : 0.55);
      if (finalScore > bs) { bs = finalScore; best = name; }
    }
    return { best, bs };
  };

  (questions || []).forEach(q => {
    const partsT = normK((q.parts || []).join(' '));
    const matT = normK(q.material || '');
    // 1) 先定大类（板块），沿用「板块头优先 + 关键词修正 + 不强标」的既有逻辑
    const coarse = scoreEntries(partsT, matT, normed);
    const isCombined = coarse.bs >= 1.5;
    const hasHint = q._knowHint && names.has(q._knowHint);
    const contentFix = isCombined && (coarse.best === '名句默写' || coarse.best === '作文') && coarse.bs >= 2.0 && coarse.best !== q._knowHint;
    let bucket;
    if (hasHint && !contentFix) bucket = q._knowHint;
    else if (isCombined) bucket = coarse.best;
    else bucket = '综合';

    // 2) 板块内再细化到具体知识点；命中不够确定就退回大类，避免错得离谱
    let label = bucket;
    const fineKws = fineNormed[bucket] || [];
    let fineBs = 0;
    if (fineKws.length) {
      const f = scoreEntries(partsT, matT, fineKws);
      fineBs = f.bs;
      if (f.bs >= 1.0 && f.best && f.best !== bucket) label = f.best;
    }
    q.knowledge = label;
    q._knowScore = fineKws.length ? fineBs : coarse.bs;
  });
}

/* --- 试卷内容解析 --- */
/* 仅对含义毫无歧义的板块头给出默认知识点（跨学科板块归入「综合」，避免错标）。
   例：「文言文阅读」「名篇名句默写」「语言文字运用」「写作」直接对应语文某知识点；
   而缺乏明确性的「阅读I/II/诗句阅读」不做默认，交给关键词匹配。 */
const SECTION_KNOW_HINT = [
  [/古代诗歌阅读|诗歌阅读|诗歌鉴赏/, '古诗词鉴赏'],
  [/现代文阅读|论述类文本|文学类文本|实用类文本/, '现代文阅读'],
  [/文言文阅读|古诗文/, '文言文阅读'],
  [/默写|名句/, '名句默写'],
  [/语言文字运用/, '语言文字运用'],
  [/写作|作文/, '作文'],
];
const knowHintOf = (header) => {
  const h = String(header || '');
  for (const [re, name] of SECTION_KNOW_HINT) if (re.test(h)) return name;
  return '';
};
const TYPE_KEY = /(选择题|单项选择|多项选择|填空题|解答题|综合题|论述题|计算题|简答题|证明题|应用题|实验题|作图题|阅读理解|阅读题|文学类文本|论述类文本|实用类文本|完形填空|任务型阅读|短文填空|语法填空|单词拼写|词汇运用|情景对话|情景交际|看图写话|默写|名句|文言文|古诗文|古代诗歌|诗歌鉴赏|语言文字运用|作文|书面表达|写作|听力|翻译|改错|短文改错|单选|阅读)/;

/* 去零碎行预处理：pdf.js 会把同属一行的文字按 Y 坐标差拆成多行（如「（本题」「6」「分）…」）。
   这里把不以“结构锚点”开头（题号/选项/小题/本章节/材料组题干）的续行粘回上一行，
   让「（本题 6 分）」「一、单选题（共 48 分）」等重新并成完整一行，便于后续规则识别。 */
const REFLOW_ANCHOR = /^(?:[一二三四五六七八九十百]{1,3}\s*[、．]|\d{1,3}\s*[、．]|\d{1,3}\.\s*(?!\d)|[A-H]\s*[\.、．）):：:]|（[一二三四五六七八九十]{1,4}）|[（(]\s*(?:本题|本组|本大题)|[（(]\s*\d+\s*[）)]|答案第|(?:下列|请|将|结合|根据|简答|概括|分析|翻译|补写|仿照|仿写|写作|简述|阅读|梳理|默写|题目|本文|上文).*(?:[（(][^）)]*\d+(?:\.\d+)?[^）)]*\s*分))/;
function reflowPaperText(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) { out.push(''); continue; }
    if (out.length && out[out.length - 1] !== '' && !REFLOW_ANCHOR.test(t)) {
      out[out.length - 1] += ' ' + t;
    } else {
      out.push(t);
    }
  }
  return out.join('\n');
}

function parsePaper(text, expectCount) {
  const lines = reflowPaperText(text).split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
  const questions = [];
  let curType = '';
  let curKnow = '';        // 当前板块对应的默认知识点（仅明确板块头时）
  let pending = null;
  let pendingPer = 0, pendingRemain = 0;
  let qCounter = 0;
  let activeGroup = -1;          // 当前"材料组"（题干为"（本题N分）……据此完成下面小题"）索引
  const groups = [];             // [{ total, members:[] }] 组总分与组内已定题目
  const GROUP_HDR = /^\s*[（(]\s*(?:本题|本组|本大题)?\s*(?:共)?\s*(\d+(?:\.\d+)?)\s*分\s*[）)]/;
  // 组总分均分：该组 N 分按组内题数均分，并把整除得到的每题分均匀赋给组内每一个小题。
  // （当组成员的单题分来源不清或仅被误赋了“组总分”时，以组总分÷题数的均分值覆盖，保证各小题都有其应得的分值）
  const distributeGroup = (gi) => {
    if (gi < 0) return;
    const g = groups[gi];
    if (!g || g.total <= 0 || g.members.length < 1) return;
    const per = g.total / g.members.length;
    if (Number.isInteger(per) && per > 0) {
      g.members.forEach(pb => { pb.fullMark = per; });
    }
  };

  const isSection = (l) => {
    if (isQuestionStart(l) || isOptionLine(l)) return false;
    // 放宽：含题型关键词即视为大题标题；长行若能带分值说明也一并识别，避免被并进首题导致分值误取
    return TYPE_KEY.test(l) && (l.length < 70 || /[（(]?\s*\d+(?:\.\d+)?\s*分|[0-9]+分/.test(l));
  };
  const isQuestionStart = (l) =>
    /^\d{1,3}\s*[、．]/.test(l) ||               // 中文顿号/全角点："1、""3．"
    /^\d{1,3}\.\s*(?!\d)/.test(l);              // 半角点，且其后不能紧跟数字（排除 "2.8" 这类小数）
  // 未编号但明显是独立小题的题干：不带题号、带"（N分）"分值且分值出现较早，以指令/问句词开头。
  // 用于阅读材料段落（（1）（2）…作小标题）后跟的裸题干，以及个别丢题号的题。
  const isUnnumberedStem = (l) => {
    if (/^[（(]\s*\d+\s*[）)]/.test(l)) return false;
    if (!/^(下列|请|将|结合|根据|简答|概括|分析|翻译|补写|仿照|仿写|写作|简述|阅读|梳理|默写|题目|本文|上文的)/.test(l)) return false;
    const i = l.search(/[（(][^）)]*\d+(?:\.\d+)?[^）)]*\s*分/);
    return i >= 0 && i < 55;
  };
  const isOptionLine = (l) => /^[ABCD][\s\.、．\)）:：]/.test(l);
  // 卷首说明/注意事项/考生信息/页脚等非试题噪音，跳过以免被当成分值或题干
  const isNoise = (l) =>
    /^(姓名|准考证号|学校|班级|座位号|注意事项|应试须知|考生须知|监考|正确填涂|当为|一律|考试结束|交卷|密封线|不要折叠|请在各题|禁止)[：:  ]/.test(l) || /^语文(科目)?$/.test(l) ||
    /本试题共\d+分|考试时长|请在答题卡|作答在答题卡|涂写在答题卡|填涂在答题卡|答案写在本试卷上|本试卷|试卷满分|第\d+页（共\d+页）|保密|选择题作答用[0-9A-Za-z]|条形码|超出答题|偏出答题|一律无效|考试结束后|一并交回|并收回/.test(l);
  // 扫描 OCR 的乱码行：无意义英文串、重复短片段、纯符号行——不进题目判定，直接丢弃
  const isGarbage = (l) => {
    const cn = (l.match(/[\u4e00-\u9fa5]/g) || []).length;
    const letters = (l.match(/[A-Za-z]/g) || []).length;
    const digits = (l.match(/\d/g) || []).length;
    if (cn === 0 && digits === 0 && letters === 0 && l.length >= 2) return true;   // 纯符号/空白
    if (cn === 0 && letters >= 3) return true;                                      // 无中文的英文幻觉（MERRIE）
    const core = l.replace(/[\s，。、！？；：“”"'\-—…·]/g, '');
    if (core.length >= 6 && /(.{1,4})\1{2,}/.test(core)) return true;               // 重复短片段（把①把①把①）
    return false;
  };
  const finalize = (pb) => {
    if (!pb) return;
    // 综合题：若带小问分值，父题分值优先取题面明确总分数，否则取小问分值合计
    let full = 0;
    if (pb.subMark && pb.subMark.length) {
      const sum = pb.subMark.reduce((a, s) => a + (s.mark || 0), 0);
      const stem0 = (pb.parts || []).filter(l => !/^[（(]\s*\d+\s*[）)]/.test(l)).join(' ');
      const ex = detectPoints(stem0);
      full = ex || sum || 0;
    } else {
      full = detectPoints((pb.parts || []).join('\n'));
    }
    if (full <= 0 && pendingPer > 0) { full = pendingPer; if (pendingRemain > 0) pendingRemain--; }
    pb.fullMark = full;
    pb.label = pb.header;
    if (curKnow) pb._knowHint = curKnow;
    if (activeGroup >= 0) {
      if (groups[activeGroup].material) pb.material = groups[activeGroup].material;
      groups[activeGroup].members.push(pb);
    }
    questions.push(pb);
  };

  for (const l of lines) {
    if (isNoise(l)) continue;                        // 跳过卷首说明/页脚
    if (isGarbage(l)) continue;                      // 跳过 OCR 乱码行
    // 大题标题（含题型关键词 + 分值说明，支持"共X小题，每小题Y分" 或 "每小题Y分……共X题" 及"每空Y分"）
    if (isSection(l)) {
      finalize(pending); pending = null;
      // 结算上一个材料组（若有）
      if (activeGroup >= 0) { distributeGroup(activeGroup); activeGroup = -1; }
      curType = (l.match(TYPE_KEY) || [''])[0];
      const hint = knowHintOf(l); if (hint) curKnow = hint;
      const pe = l.match(/(?:小题|每题|每道|每小问|题)\s*(\d+(?:\.\d+)?)\s*分/);
      const pk = l.match(/每空\s*(\d+(?:\.\d+)?)\s*分/);
      if (pe || pk) {
        pendingPer = parseFloat((pe || pk)[1]);
        const cnt = l.match(/共\s*(\d+)\s*[小]{0,1}题/);
        pendingRemain = cnt ? parseInt(cnt[1], 10) : 0;
        if (!pendingRemain && pendingPer > 0) {
          // 用"共X分"总分反推题数：如"每小题2分，共10分"→5题
          const tp = l.match(/共\s*(\d+(?:\.\d+)?)\s*分/);
          if (tp) pendingRemain = Math.max(1, Math.round(parseFloat(tp[1]) / pendingPer));
        }
      } else if (!l.includes('每题') && !l.includes('每空')) {
        pendingPer = 0; pendingRemain = 0;
      }
      continue;
    }
    if (isOptionLine(l)) { if (pending) pending.parts.push(l); continue; }
    // 材料组题干："（本题N分）……据此完成下面小题" —— N 是该组总分，开启一个新组并结算上一组
    const gh = l.match(GROUP_HDR);
    if (gh && !isQuestionStart(l)) {
      finalize(pending); pending = null;
      if (activeGroup >= 0) distributeGroup(activeGroup);
      // 记录材料组正文（去掉"（本题N分）"前缀），供其后各小题共享匹配知识点
      activeGroup = groups.push({ total: parseFloat(gh[1]) || 0, members: [], material: l.replace(GROUP_HDR, '').trim() }) - 1;
      continue;
    }
    // 综合题/大题的括号小问 "(1)" "（2）" ：作为当前大题的子部分并入，不再另起题目；同时记录每个小问分值
    if (/^[\(（]\s*\d+\s*[\)）]/.test(l) && pending) {
      if (pending.parts.length < 14) pending.parts.push(l);
      pending.subMark = pending.subMark || [];
      // 取小问号之后紧跟的分值，兼容 "（1）8分"、"（1）本题6分" 等写法
      const qn = l.match(/^\s*[\(（]\s*(\d+)\s*[\)）]/);
      const rest = qn ? l.slice(qn[0].length) : l;
      for (const sm of rest.matchAll(/(\d+(?:\.\d+)?)\s*分/g)) {
        const v = parseFloat(sm[1]);
        if (v > 0 && v <= 100) pending.subMark.push({ no: qn ? qn[1] : pending.subMark.length + 1, mark: v });
      }
      continue;
    }
    if (isQuestionStart(l) || isUnnumberedStem(l)) {
      finalize(pending); pending = null;
      qCounter++;
      pending = { qid: 'Q' + qCounter, type: curType, knowledge: '', parts: [l], header: l };
      continue;
    }
    if (pending && pending.parts.length < 14) pending.parts.push(l);
  }
  finalize(pending);
  if (activeGroup >= 0) distributeGroup(activeGroup);

  // 当题数与期望（答案侧）接近但不全时，按题号前缀归并去重
  if (expectCount && questions.length !== expectCount) { /* 预留：主试卷为准 */ }
  return questions;
}
/* 从题干文本中提取该题分值，兼容各试卷的不同写法。
 * 取分优先级（由可信到兜底）：
 *  1) 明确的"本题/该题/本小问 X 分"
 *  2) 括号分值"（X分）"，但剔除紧跟"共/合计/总计/组内/本组/总分"的汇总值，取第一个干净的
 *  3) 题干中唯一的"X分"（前文不是 共/每）
 *  4) 兜底：未匹配到 ≥0，交由 section 的"每小题X分"（pendingPer）补齐 */
function detectPoints(text) {
  if (!text) return 0;
  const stem = String(text).replace(/[\r\n]+/g, ' ');
  // 1) 明确单题分值
  let m = stem.match(/(?:本题|该题|本小问)\s*(?:满分)?\s*(\d+(?:\.\d+)?)\s*分/);
  if (m) return parseFloat(m[1]);
  // 2) 括号分值，剔除汇总类（"（本题共5小题，19分）""（共19分）"等大题总分不作单题分）
  const clean = [];
  const SECT_WORDS = /(阅读|阅读理解|古代诗文|古诗文|文言文|古代诗歌|诗歌|名句|默写|语言文字|文学|现代文|论述类|实用类|听力|完形|填空|翻译)/;
  for (const o of stem.matchAll(/[（(]([^（）()]*?)(\d+(?:\.\d+)?)\s*分\s*[）)]/g)) {
    const pre = (o[1] || '').trim();              // 括号内、分值数字前的整段文字
    const v = parseFloat(o[2]);
    if (/(共|合计|总计|组内|本组|该组|总分|小题|每题|每空|每点)/.test(pre)) continue;   // 汇总口径
    // 括号内是板块名且很短（"（古代诗歌阅读9分）"），或括号前紧邻板块名（"古代诗歌阅读(9分)"）→ 判为大题总分
    const preBefore = stem.slice(Math.max(0, o.index - 6), o.index);
    if (!/(作文|写作)/.test(pre + preBefore) &&
        (SECT_WORDS.test(preBefore) || (pre.length <= 6 && SECT_WORDS.test(pre)))) continue;
    // 单题分不应大到异常（>30 仅作文/本题明确分值可信），拦截板块总分泄漏
    if (v >= 30 && !/(作文|写作|本题|该题|本小问)/.test(pre)) continue;
    clean.push(v);
  }
  if (clean.length) return clean[0];
  // 3) 唯一的"X分"：作文/写作分值可信；其余若其前紧邻板块名或汇总口径(阅读/文言文/诗歌/共/合计…)，是大题总分，不取
  const all = [...stem.matchAll(/(\d+(?:\.\d+)?)\s*分/g)];
  if (all.length === 1) {
    const pre = stem.slice(Math.max(0, all[0].index - 8), all[0].index);
    if (/(作文|写作)/.test(pre)) return parseFloat(all[0][1]);
    if (/(共|合计|总计|总分|小题|本组|该组|每组|每题|每空|每点|阅读|文言文|古诗文|诗歌|古代诗歌|名句|默写|语言文字|文学|现代文|论述|实用|听力|完形|填空|翻译)/.test(pre)) return 0;
    return parseFloat(all[0][1]);
  }
  return 0;
}

/* --- 用答案的分值校准试卷中缺失的分值（按序号） --- */
function mergeByPoints(paperQ, answerQ) {
  paperQ.forEach((q, i) => {
    if (!q.fullMark && answerQ[i] && answerQ[i].fullMark) {
      q.fullMark = answerQ[i].fullMark;
    }
  });
  return paperQ;
}

/* ============================================================
 *  一键导入向导
 * ========================================================== */
const WIZ = {
  step: 1,
  paperFile: null,     // File | null
  answerFile: null,    // File | null
  scoreFile: null,     // File | null
  questions: [],       // 识别出的题目（模板草稿）
  students: [],        // 导入的学生成绩
  answerText: '',      // 答案提取文本（用于分值标注预览）
  resultExamId: null,
};
const wizStuTotal = (s) => Object.keys(s.scores || {}).reduce((a, k) => a + (toNum(s.scores[k]) || 0), 0);
/* 综合题的小问分值提示文案，如 "(1) 8分    (2) 4分    (3) 6分  合计 18分" */
const wizMarkNote = (q) => {
  if (!q.subMark || !q.subMark.length) return '';
  const sum = q.subMark.reduce((a, s) => a + (s.mark || 0), 0);
  const list = q.subMark.map(s => `(${s.no}) ${s.mark}分`).join('   ');
  return sum > 0 ? `${list}${(q.fullMark ? '' : '   合计 ' + sum + '分')}` : list;
};

function convertFile(file) {
  const name = (file.name || '').toLowerCase();
  if (/\.(xlsx|xls)$/i.test(name) || /(excel|spreadsheet)/.test(file.type)) return 'scores';
  if (/\.csv$/i.test(name)) return 'scores';
  if (/\.(pdf|docx?)$/i.test(name) || /(pdf|word)/.test(file.type)) {
    if (/答案|参考答案|答案解析|解析|key|answer|solution/i.test(name)) return 'answer';
    return 'paper';
  }
  return 'paper';
}

function resetWizard() {
  WIZ.step = 1;
  WIZ.paperFile = null; WIZ.answerFile = null; WIZ.scoreFile = null;
  WIZ.questions = []; WIZ.students = []; WIZ.answerText = '';
  $('#impName').value = '';
  $('#impSubject').value = '';
  $('#impProgress').textContent = '';
  $('#impSummary').textContent = '';
  $('#impResult').innerHTML = '';
  renderWizFileList();
  setWizStep(1);
}

function setWizStep(n) {
  WIZ.step = n;
  document.querySelectorAll('#impStepper .step').forEach(st =>
    st.classList.toggle('active', +st.dataset.impstep === n));
  document.querySelectorAll('.import-step').forEach(c =>
    c.classList.toggle('hidden', +c.dataset.imp !== n));
}

function guessSubject() {
  const sel = $('#impSubject');
  if (sel.value) return;
  const all = (WIZ.paperFile && WIZ.paperFile.name || '') +
    (WIZ.answerFile && WIZ.answerFile.name || '') +
    (WIZ.scoreFile && WIZ.scoreFile.name || '');
  const hit = SUBJECTS.find(s => all.includes(s.name));
  if (hit) sel.value = hit.id;
}

function handleWizFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  files.forEach(f => {
    const type = convertFile(f);
    if (type === 'scores') WIZ.scoreFile = f;
    else if (type === 'answer') WIZ.answerFile = f;
    else WIZ.paperFile = f;
  });
  files.forEach(f => {
    if (!WIZ.paperFile && convertFile(f) !== 'scores' && convertFile(f) !== 'answer'
      && !/答案|解析/i.test(f.name)) WIZ.paperFile = WIZ.paperFile || null;
  });
  // 自动命名：以试卷/成绩文件名作为考试名
  if (!$('#impName').value.trim()) {
    const n = (WIZ.paperFile && WIZ.paperFile.name) || (WIZ.scoreFile && WIZ.scoreFile.name) || '';
    $('#impName').value = n.replace(/\.[^.]+$/, '');
  }
  guessSubject();
  renderWizFileList();
}

function renderWizFileList() {
  const box = $('#impFileList');
  const items = [];
  if (WIZ.paperFile) items.push({ k: 'paper', label: '试卷', f: WIZ.paperFile });
  if (WIZ.answerFile) items.push({ k: 'answer', label: '答案', f: WIZ.answerFile });
  if (WIZ.scoreFile) items.push({ k: 'scores', label: '成绩Excel', f: WIZ.scoreFile });
  box.innerHTML = items.map(it => `
    <div class="imp-file"><span class="role-tag ${it.k}">${it.label}</span><span class="fn">${esc(it.f.name)}</span>
      <button class="icon-btn" data-rm="${it.k}" title="移除">✕</button></div>`).join('');
  box.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.rm;
    if (k === 'paper') WIZ.paperFile = null;
    else if (k === 'answer') WIZ.answerFile = null;
    else WIZ.scoreFile = null;
    renderWizFileList();
  }));
  const hasDoc = !!(WIZ.paperFile || WIZ.answerFile);
  const hasScore = !!WIZ.scoreFile;
  $('#btnImpStart').disabled = !(hasDoc && hasScore);
  $('#impStartHint').innerHTML =
    (!hasDoc ? '<span style="color:var(--danger)">请拖入试卷 / 答案 PDF·Word</span><br>' : '') +
    (!hasScore ? '<span style="color:var(--danger)">请拖入成绩 Excel</span><br>' : '') +
    (hasDoc && hasScore ? '文件齐全，可开始识别。' : '');
}

/* --- 识别主流程：试卷+答案 文字提取 → 题号/分值 → 任务分合并；成绩Excel导入 --- */
async function wizParse() {
  setWizStep(2);
  WIZ.questions = []; WIZ.students = [];
  const prog = $('#impProgress');
  const summary = $('#impSummary');
  summary.innerHTML = '';
  try {
    // 1. 试卷文字提取（扫描件自动 OCR）
    let qList = [];
    let paperText = '';
    if (WIZ.paperFile) {
      prog.textContent = '正在提取试卷文字…';
      paperText = await extractText(WIZ.paperFile);
      if (paperText.replace(/\s/g, '').length < 60) {
        throw new Error('试卷是扫描版 PDF（无文字层）。本系统已停止支持扫描件识别，请改为上传文字版 PDF 或 Word(.docx)。');
      }
    }
    // 2. 答案文字提取
    let ansQList = [];
    if (WIZ.answerFile) {
      prog.textContent = '正在提取答案文字…';
      WIZ.answerText = await extractText(WIZ.answerFile);
      ansQList = parsePaper(WIZ.answerText);
    }
    // 3. 组合题目：试卷为主，答案补充 + 分值校准
    if (paperText.replace(/\s/g, '').length >= 40) {
      qList = parsePaper(paperText, ansQList.length || 0);
    } else if (ansQList.length) {
      qList = ansQList; // 无试卷时退化为用答案建题
    }
    if (ansQList.length) qList = mergeByPoints(qList, ansQList);
    qList.forEach((q, i) => {
      if (!q.qid) q.qid = 'Q' + (i + 1);
      if (!q.knowledge) q.knowledge = '综合';
      if (!q.type) q.type = '未分类';
      if (!q.fullMark) q.fullMark = 0;
      q.sort = i + 1;
    });
    WIZ.questions = qList;
    // 诊断信息：记录试卷/答案提取情况与题目来源，供核对页面展示
    WIZ._diag = {
      paperChars: paperText.replace(/\s/g, '').length,
      ansChars: (WIZ.answerText || '').replace(/\s/g, '').length,
      hasPaper: !!WIZ.paperFile, hasAnswer: !!WIZ.answerFile,
      source: qList.length ? '试卷解析' : (paperText.replace(/\s/g, '').length ? '试卷解析(0题)' : ''),
      qCount: qList.length, ver: APP_VERSION,
    };
    // 自动按题目文字标注知识点
    autoKnowledge(WIZ.questions, $('#impSubject').value || WIZ._subjectId || SUBJECTS[0].id);
    // 4. 成绩 Excel 导入
    if (WIZ.scoreFile) {
      prog.textContent = '正在导入成绩 Excel…';
      const buf = await WIZ.scoreFile.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const imp = wizImportScores(wb);
      if (!imp.ok) throw new Error('成绩 Excel 未识别到学生数据。' + (imp.diag || ''));
      WIZ.students = imp.students;
    }
    // 汇总
    const withP = WIZ.questions.filter(q => q.fullMark > 0).length;
    summary.innerHTML = `识别完成：题目 <b>${WIZ.questions.length}</b> 道（其中 <b>${withP}</b> 道已带分值），
      导入学生 <b>${WIZ.students.length}</b> 人。` +
      (withP < WIZ.questions.length ? `<br><span class="hint">部分题目未识别到分值，请在下一步补填。</span>` : '');
    renderWizReview();
    setWizStep(3);
  } catch (err) {
    console.error('[一键导入] 识别失败：', err);
    prog.textContent = '识别未完成，请根据下方提示处理后重试。';
    summary.innerHTML =
      '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px 16px;text-align:left">' +
      '<span style="color:#b91c1c;font-weight:700">识别失败：</span>' +
      '<span style="color:#991b1b">' + esc(err.message) + '</span></div>' +
      '<p class="hint" style="margin-top:10px">可点击下方“上一步”返回修改或重新上传文件后重试。' +
      '常见原因：文件损坏或非标准版式、sheet 列名不含姓名/学号、.doc 旧格式浏览器无法解析（请另存为 .docx 或 PDF）。</p>';
    setWizStep(2);
    toast('识别失败：' + err.message, 'err');
  }
}

function wizImportScores(wb) {
  // 成绩表可能按科目分多个 sheet：自动选"题目列匹配最准"的那张
  // （科目同名优先，再按直接命中题目名的数量排序），不依赖下拉框选对科目
  const subjName = (() => {
    const id = WIZ._subjectId || (($('#impSubject')) && $('#impSubject').value);
    const s = SUBJECTS.find(x => x.id === id);
    return s ? s.name : '';
  })();
  const all = wb.SheetNames || [];
  const nameSheets = [], scoreSheets = [];
  let best = null;
  for (let i = 0; i < all.length; i++) {
    const res = importScoreSheet(wb.Sheets[all[i]]);
    if (!res) continue;
    if (res.hasName) nameSheets.push(all[i]);
    if (res.count === 0) continue;
    if (res.direct > 0) scoreSheets.push(all[i]);
    const score = res.direct * 10000
      + (subjName && all[i].includes(subjName) ? 1000 : 0)
      + (all.length - i);
    if (!best || score > best.score) best = { res, score, sn: all[i] };
  }
  if (!best) {
    let diag;
    if (!all.length) diag = '该文件里没有可用的工作表(sheet)。';
    else if (!nameSheets.length) diag = `该文件有 ${all.length} 个 sheet，但表头里都找不到"姓名/学号"，请确认上传的是「成绩明细」表。`;
    else if (!scoreSheets.length) diag = `找到姓名列表头（${nameSheets.join('、')}），但没有匹配到任何小题得分列——请确认分数是"每小题一列"而非只给总分。`;
    else diag = `已尝试 ${all.length} 个 sheet（${all.join('、')}），均未能对到题目列。`;
    return { ok: false, diag };
  }
  const use = best.res;
  // 无试卷/答案题目时，用成绩表表头自动推断出的小题
  if (use.auto && use.qList && use.qList.length) {
    WIZ._diag = Object.assign({}, WIZ._diag, { source: '成绩Excel表头自动生成（试卷未提取到文字）', qCount: use.qList.length });
    WIZ.questions = use.qList.map((q, i) => ({
      qid: q.qid || ('Q' + (i + 1)), type: q.type || '未分类',
      knowledge: q.knowledge || '综合', fullMark: q.fullMark || 0, sort: i + 1,
    }));
  }
  return {
    ok: true, count: use.count, students: use.students,
    diag: `使用工作表「${best.sn}」，识别学生 ${use.count} 人。` +
      (use.auto ? ` 已按表头自动生成 ${use.qList.length} 道小题，请在下一步核对分值。` : ''),
  };
}
function importScoreSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return { students: [], count: 0, direct: 0, hasName: false };
  const lastNum = (s) => { const m = String(s).match(/(\d+)/g); return m ? +m[m.length - 1] : null; };
  // 定位"姓名/学生"标识所在表头行（多级合并表头以此为基准）
  const nameRi = rows.findIndex(r => r.some(c => /姓名|学生|name/i.test(String(c))));
  if (nameRi < 0) return { students: [], count: 0, direct: 0, hasName: false };
  const nameCol = rows[nameRi].findIndex(c => /姓名|学生|name/i.test(String(c)));
  // 表头可能有多层（如 语文→客观题→单选1 三层合并、标题行/二维码行等），
  // 数据起始行 = 姓名所在列首次出现真实内容的那一行
  let dataStart = nameRi + 1;
  while (dataStart < rows.length) {
    const cell = rows[dataStart] && rows[dataStart][nameCol];
    if (cell !== '' && cell != null) break;
    dataStart++;
  }
  if (dataStart >= rows.length) dataStart = nameRi + 1;
  // 把 姓名行 到 数据行 之前的每一层表头合成一行：自下而上取每列【最后一个非空】表头，
  // 这样下层的"单选1"能覆盖上层的"客观题/语文"，多层合并表头也能逐列正确归一到最具体的小题名
  const ncol = Math.max(...rows.slice(nameRi, dataStart).map(r => (r ? r.length : 0)));
  const headers = [];
  for (let c = 0; c < ncol; c++) {
    let v = '';
    for (let rr = nameRi; rr < dataStart; rr++) {
      const cell = rows[rr] && rows[rr][c];
      if (cell !== '' && cell != null) v = String(cell).trim();
    }
    headers[c] = v;
  }
  const nameIdx = headers.findIndex(h => /姓名|学生|name/i.test(h));
  const noIdx = headers.findIndex(h => /(学号|考号|\bid\b)/i.test(h) && !/姓名/.test(h));
  if (nameIdx < 0) return { students: [], count: 0, direct: 0, hasName: false };
  const minIdx = Math.max(nameIdx, noIdx) + 1; // 小题列从学生标识列之后开始找
  // 构建学生成绩行（idxArr[i] 对应第 个小题列的列号，qids[i] 是该小题题号）
  const buildStudents = (idxArr, qids) => {
    const out = [];
    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const name = nameIdx >= 0 ? String(row[nameIdx]).trim() : '';
      const no = noIdx >= 0 ? String(row[noIdx]).trim() : '';
      if (!name && !no) continue;
      const scores = {};
      idxArr.forEach((idx, k) => {
        const v = idx >= 0 ? row[idx] : 0;
        scores[qids[k]] = v === '' || v == null ? 0 : Math.max(0, toNum(v) || 0);
      });
      out.push({ id: uid(), name: name || '学生' + (r + 1), no, scores });
    }
    return out;
  };

  // —— 没有试卷/答案题目时：直接从成绩表表头自动推断小题 ——
  if (WIZ.questions.length === 0) {
    const isAgg = (h) => /(总分|合计|总计|班名次|校名次|名次|排名|得分率|平均|客观|主观)$/.test(h);
    const cand = [];
    for (let c = minIdx; c < headers.length; c++) {
      const h = headers[c] || '';
      if (!h || isAgg(h)) continue;
      if (lastNum(h) !== null || /(单选|多选|选择|判断|填空|简答|解答|问答|计算|作|阅读|默写|翻译)$/.test(h)) cand.push(c);
    }
    if (!cand.length) return { students: [], count: 0, direct: 0, hasName: true };
    const qList = [];
    for (const c of cand) {
      let mx = 0;
      for (let r = dataStart; r < rows.length; r++) {
        const v = rows[r] ? parseFloat(rows[r][c]) : NaN;
        if (!isNaN(v) && v > mx) mx = v;
      }
      const h = headers[c];
      let type = '主观题';
      if (/多选/.test(h)) type = '多选题';
      else if (/单选|选择/.test(h)) type = '选择题';
      else if (/判断/.test(h)) type = '判断题';
      else if (/填空/.test(h)) type = '填空题';
      else if (/作/.test(h)) type = '写作';
      qList.push({ qid: h, type, knowledge: '综合', fullMark: mx });
    }
    const students = buildStudents(cand.slice(), qList.map(q => q.qid));
    return { students, count: students.length, qList, direct: qList.length, hasName: true, auto: true };
  }

  // 题目 → Excel 列：按题号末尾数字匹配（"单选1" ↔ 题1，"Q3" ↔ 题3）
  const qHeadIdx = WIZ.questions.map(q => {
    const n = lastNum(q.qid);
    if (n == null) return -1;
    return headers.findIndex((h, i) => i >= minIdx && lastNum(h) === n);
  });
  // 直接按题号数字命中表头的题目数（用于跨科目 sheet 自动挑选正确的一张）
  const direct = qHeadIdx.filter(i => i >= 0).length;
  // 兜底：仍未命中的题目，按顺序补到剩余"数字结尾"列上，尽量多带入分值（同一列不重复占用）
  if (direct < WIZ.questions.length) {
    const numCols = headers.map((h, i) => ({ i, n: lastNum(h) }))
      .filter(x => x.i >= minIdx && x.n !== null).map(x => x.i);
    const used = new Set(qHeadIdx.filter(i => i >= 0));
    let ci = 0;
    for (let k = 0; k < WIZ.questions.length && ci < numCols.length; k++) {
      if (qHeadIdx[k] >= 0) continue;
      while (ci < numCols.length && used.has(numCols[ci])) ci++;
      if (ci < numCols.length) { qHeadIdx[k] = numCols[ci]; used.add(numCols[ci]); ci++; }
    }
  }
  // 至少要有题目列才算与试卷对应；完全没有则视为不相关 sheet，交给上层换别的 sheet 试
  if (direct === 0) return { students: [], count: 0, direct: 0, hasName: true };
  const students = buildStudents(qHeadIdx, WIZ.questions.map(q => q.qid));
  return { students, count: students.length, direct, hasName: true };
}

/* --- 核对页渲染 --- */
function renderWizReview() {
  // 诊断横幅：版本号 + 试卷/答案文字提取情况 + 题目来源，一眼定位是否缓存旧版或提取失败
  const dg = $('#impDiag');
  if (dg) {
    const d = WIZ._diag || {};
    const srcBad = d.source && /未提取到|表头自动生成|0题/.test(d.source);
    dg.innerHTML =
      `<span class="diag-item">版本 <b>${esc(d.ver || APP_VERSION || '-')}</b></span>` +
      `<span class="diag-item">试卷文件 ${d.hasPaper ? '✅' : '❌未传'} 提取 <b>${d.paperChars ?? '-'}</b> 字</span>` +
      `<span class="diag-item">答案文件 ${d.hasAnswer ? '✅' : '❌未传'} 提取 <b>${d.ansChars ?? '-'}</b> 字</span>` +
      `<span class="diag-item">题目来源：<b class="${srcBad ? 'warn' : ''}">${esc(d.source || '未知')}</b>（${d.qCount ?? 0} 题）</span>`;
  }
  // ① 题目清单
  const qt = $('#impQTable');
  qt.innerHTML = '<thead><tr><th style="width:90px">题号</th><th style="width:110px">题型</th><th>知识点</th><th style="width:90px">分值</th><th style="width:44px"></th></tr></thead><tbody>';
  const qb = qt.querySelector('tbody');
  WIZ.questions.forEach((q, i) => {
    const tr = document.createElement('tr');
    tr.dataset.i = String(i);
    tr.innerHTML = `<td><input class="cell" data-k="qid" value="${esc(q.qid)}"></td>
      <td><input class="cell" style="width:100%" data-k="type" value="${esc(q.type)}"></td>
      <td><input style="width:100%;min-width:120px" data-k="knowledge" value="${esc(q.knowledge)}"></td>
      <td><input class="cell" type="number" min="0" step="any" data-k="fullMark" value="${q.fullMark || ''}">
          ${wizMarkNote(q) ? `<div class="wiz-submark" title="识别到的小问分值">${esc(wizMarkNote(q))}</div>` : ''}</td>
      <td style="white-space:nowrap"><button class="icon-btn" data-expand title="查看原文">▾</button>
          <button class="icon-btn" data-del title="删除">✕</button></td>`;
    qb.appendChild(tr);
    // 题目原文展开区：点击 ▾ 显示/隐藏该题识别到的原始题干文字
    const rawRow = document.createElement('tr');
    rawRow.className = 'wiz-raw-row';
    rawRow.innerHTML = `<td colspan="5"><div class="wiz-raw">${esc((q.parts || []).join('\n')) || '<span class="hint">（未捕获到原文）</span>'}</div></td>`;
    qb.appendChild(rawRow);
    const exBtn = tr.querySelector('[data-expand]');
    if (exBtn) exBtn.addEventListener('click', () => {
      const hidden = rawRow.classList.toggle('hidden');
      exBtn.textContent = hidden ? '▾' : '▴';
    });
  });
  qt.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const i = +b.closest('tr').dataset.i;
    if (isNaN(i)) return;
    WIZ.questions.splice(i, 1); renderWizReview();
  }));
  qt.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
    const i = +inp.closest('tr').dataset.i;
    if (isNaN(i)) return;
    const k = inp.dataset.k;
    WIZ.questions[i][k] = k === 'fullMark' ? (toNum(inp.value) || 0) : (inp.value.trim() || '综合');
    updateQTitle();
  }));

  // 批量补分值：按题型给满分的题统一补值
  const bt = $('#impBulkType');
  if (bt) {
    const cur = bt.value;
    const types = [...new Set(WIZ.questions.map(q => (q.type || '未分类').trim()).filter(Boolean))];
    bt.innerHTML = '<option value="">全部题型</option>' + types.map(t2 => `<option value="${esc(t2)}">${esc(t2)}</option>`).join('');
    if (cur) bt.value = cur;
  }
  const bm = $('#btnImpBulkMark');
  if (bm) {
    bm.onclick = () => {
      const v = toNum($('#impBulkVal').value || '');
      const typ = ($('#impBulkType').value || '').trim();
      if (isNaN(v) || v < 0) { toast('请先填写要补的分值', 'err'); return; }
      let n = 0;
      WIZ.questions.forEach(q => {
        const hit = !typ || (q.type || '').trim() === typ;
        if (hit && (!q.fullMark)) { q.fullMark = v; n++; }
      });
      if (n === 0 && typ) { WIZ.questions.forEach(q => { if ((q.type || '').trim() === typ) { q.fullMark = v; n++; } }); }
      toast(`已为 ${n} 题补上分值 ${v} 分`, n ? 'ok' : 'err');
      renderWizReview();
    };
  }

  // 满分自修复：扫描版 OCR 单题满分偶有缺失或误判，用本卷该题实收最高分校正表头「/N」
  WIZ.questions.forEach(q => {
    let obs = 0;
    WIZ.students.forEach(s => { const v = toNum((s.scores || {})[q.qid]) || 0; if (v > obs) obs = v; });
    if (obs > 0 && (!q.fullMark || q.fullMark < obs)) q.fullMark = obs;
  });

  // ② 学生成绩
  const st = $('#impScoreTable');
  let h = '<thead><tr><th style="min-width:70px">学号</th><th style="min-width:70px">姓名</th>';
  WIZ.questions.forEach(q => h += `<th title="${esc(q.knowledge)}">${esc(q.qid)}<br><span style="font-size:11px;color:#94a3b8">/${q.fullMark || ''}</span></th>`);
  h += '<th style="min-width:60px">总分</th><th style="width:44px"></th></tr></thead><tbody>';
  WIZ.students.forEach(stu => {
    h += `<tr><td><input class="cell" data-f="no" value="${esc(stu.no || '')}"></td><td><input class="cell" data-f="name" value="${esc(stu.name || '')}"></td>`;
    WIZ.questions.forEach(q => {
      const v = stu.scores ? stu.scores[q.qid] : '';
      h += `<td><input class="cell" type="number" min="0" step="any" data-q="${esc(q.qid)}" value="${v != null ? v : ''}"></td>`;
    });
    h += `<td class="row-total">${wizStuTotal(stu)}</td><td><button class="icon-btn row-del" title="删除">✕</button></td></tr>`;
  });
  h += '</tbody>';
  st.innerHTML = h;
  st.querySelectorAll('.row-del').forEach(b => b.addEventListener('click', () => {
    const i = [...st.querySelectorAll('tbody tr')].indexOf(b.closest('tr'));
    WIZ.students.splice(i, 1); renderWizReview();
  }));
  st.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
    const i = [...st.querySelectorAll('tbody tr')].indexOf(inp.closest('tr'));
    if (i < 0) return;
    const stu = WIZ.students[i];
    if (inp.dataset.f === 'no') stu.no = inp.value.trim();
    else if (inp.dataset.f === 'name') stu.name = inp.value.trim();
    else {
      const v = inp.value === '' ? 0 : toNum(inp.value);
      stu.scores = stu.scores || {};
      stu.scores[inp.dataset.q] = isNaN(v) ? 0 : Math.max(0, v);
    }
    const tot = inp.closest('tr').querySelector('.row-total');
    if (tot) tot.textContent = wizStuTotal(stu);
  }));
  updateQTitle();
}
function updateQTitle() {
  const t = $('#impScoreTable thead');
  if (!t) return;
  const ths = t.querySelectorAll('th');
  if (ths.length < 3) return;
  WIZ.questions.forEach((q, i) => {
    const th = ths[i + 2];
    if (th) th.title = q.knowledge || '综合';
  });
}

/* --- ③ 归档预览（答案含分值标注） --- */
async function wizPreview(which) {
  const file = which === 'paper' ? WIZ.paperFile : WIZ.answerFile;
  if (!file) { toast('尚未上传该文件', 'err'); return; }
  $('#archiveTitle').textContent = (which === 'paper' ? '试卷' : '答案') + '预览 — ' + file.name;
  const body = $('#archiveBody');
  if (which === 'answer' && WIZ.answerText.replace(/\s/g, '').length >= 40) {
    body.innerHTML = '<div style="padding:20px;background:#fff;border:1px solid var(--line);border-radius:10px;max-width:820px;margin:0 auto;white-space:pre-wrap;line-height:1.9;font-size:14px;color:#1e293b">' +
      esc(WIZ.answerText)
        .replace(/(每题)\s*(\d+(?:\.\d+)?)\s*分/g, '$1<mark>$2分</mark>')
        .replace(/\(\s*(\d+(?:\.\d+)?)\s*分\s*\)/g, '<mark>($1分)</mark>') +
      '</div><p class="hint" style="margin-top:10px;text-align:center">已自动标注识别到的分值（黄色高亮），请据此在"题目清单"中补全分值。</p>';
  } else {
    const dataUrl = await readAsDataURL(file);
    await renderPreview(body, { name: file.name, type: file.type, dataUrl });
  }
  $('#archiveModal').classList.remove('hidden');
}

/* --- 确认：自动建模板/考试/审核并进入输出 --- */
async function wizConfirm() {
  const name = $('#impName').value.trim() || '智能导入考试';
  const subjectId = $('#impSubject').value || WIZ._subjectId || SUBJECTS[0].id;
  if (!WIZ.questions.length) { toast('请至少保留一道题目', 'err'); return; }
  if (!WIZ.students.length && !confirm('当前没有学生成绩，仍要创建并输出报告吗？')) return;
  $('#btnImpConfirm').disabled = true;
  toast('正在创建考试并自动审核…');
  try {
    // 建模板
    const tpl = {
      id: uid(), name: name + '·模板', subjectId,
      questions: WIZ.questions.map((q, i) => ({
        sort: i + 1, qid: q.qid || ('Q' + (i + 1)), label: q.qid || ('Q' + (i + 1)),
        type: q.type || '未分类', knowledge: q.knowledge || '综合', fullMark: q.fullMark || 0,
        subMark: (q.subMark && q.subMark.length) ? q.subMark : undefined,
      })),
    };
    state.templates.push(tpl);
    store(DB.templates, state.templates);
    // 建考试
    const exam = {
      id: uid(), name, subjectId, templateId: tpl.id,
      date: new Date().toISOString().slice(0, 10),
      students: WIZ.students,
    };
    state.exams.unshift(exam);
    // 归档文件
    const arc = {};
    if (WIZ.paperFile) {
      const du = await readAsDataURL(WIZ.paperFile);
      arc.paper = { name: WIZ.paperFile.name, type: WIZ.paperFile.type, dataUrl: du };
      exam.paper = { name: WIZ.paperFile.name, type: WIZ.paperFile.type };
      exam.hasPaper = true;
    }
    if (WIZ.answerFile) {
      const du = await readAsDataURL(WIZ.answerFile);
      arc.answer = { name: WIZ.answerFile.name, type: WIZ.answerFile.type, dataUrl: du };
      exam.answer = { name: WIZ.answerFile.name, type: WIZ.answerFile.type };
      exam.hasAnswer = true;
    }
    await idb.put('arc_' + exam.id, arc);
    store(DB.exams, state.exams);
    // 自动审核
    state.currentExamId = exam.id;
    WIZ.resultExamId = exam.id;
    runAnalysis();
    setWizStep(4);
    const A = state.lastAnalysis;
    $('#impResult').innerHTML = `
      <p class="hint" style="font-size:14px;color:#0f766e;margin:8px 0">
        考试〈${esc(name)}〉已创建，系统已自动完成：题目识别 ${A.tpl.questions.length} 题、成绩导入 ${A.std.length} 人、
        逐题统计、学生逐题评价与整体评价。</p>
      <p class="hint">可导出下方两份 Excel 报告；也可
        <button class="mini-btn" onclick="switchView('analysis')">查看分析详情</button> 或到
        <button class="mini-btn" onclick="switchView('exams')">考试管理</button> 中预览归档。</p>`;
    toast('审核完成，报告已生成');
  } catch (err) {
    toast('导出失败：' + err.message, 'err');
    $('#btnImpConfirm').disabled = false;
  } finally {
    $('#btnImpConfirm').disabled = false;
  }
}

/* --- 向导 UI 绑定（只绑一次） --- */
function bindWizardUI() {
  const dz = $('#dropzone'), input = $('#impFiles');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); handleWizFiles(e.dataTransfer.files); });
  input.addEventListener('change', () => { handleWizFiles(input.files); input.value = ''; });
  $('#btnImpStart').addEventListener('click', wizParse);
  $('#btnImpBack1').addEventListener('click', () => setWizStep(1));
  $('#btnImpBack2').addEventListener('click', () => setWizStep(1));
  $('#btnImpGotoReview').addEventListener('click', () => { renderWizReview(); setWizStep(3); });
  $('#btnImpAddQ').addEventListener('click', () => {
    WIZ.questions.push({ qid: 'Q' + (WIZ.questions.length + 1), type: '选择题', knowledge: '综合', fullMark: 0, sort: WIZ.questions.length + 1 });
    renderWizReview();
  });
  $('#btnImpAddStu').addEventListener('click', () => {
    WIZ.students.push({ id: uid(), name: '新学生' + (WIZ.students.length + 1), no: '', scores: {} });
    renderWizReview();
  });
  $('#btnImpPaper').addEventListener('click', () => wizPreview('paper'));
  $('#btnImpAnswer').addEventListener('click', () => wizPreview('answer'));
  $('#btnImpConfirm').addEventListener('click', wizConfirm);
  $('#btnImpExpClass').addEventListener('click', () => $('#btnExportClass').click());
  $('#btnImpExpStu').addEventListener('click', () => $('#btnExportStudents').click());
  $('#btnImpAnother').addEventListener('click', () => resetWizard());
}

function initWizard() {
  const sel = $('#impSubject');
  if (!sel.dataset.done) {
    sel.innerHTML = '<option value="">选择科目</option>' + SUBJECTS.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    sel.dataset.done = '1';
    sel.addEventListener('change', () => { WIZ._subjectId = sel.value; });
  }
  if (sel.value) WIZ._subjectId = sel.value;
  resetWizard();
}

/* ============================================================
 *  初始化
 * ========================================================== */
function initAll() {
  // 展示运行版本号，便于判断浏览器是否还缓存着旧脚本
  document.getElementById('appVer') && (document.getElementById('appVer').textContent = APP_VERSION);
  bindWizardUI();
  // 科目变化时联动刷新模板下拉
  $('#examSubject').addEventListener('change', () => {
    fillTemplates($('#examTemplate'), null, $('#examSubject').value);
  });
  // 生成分析
  $('#btnAnalyze').addEventListener('click', runAnalysis);
  // 新增学生
  $('#btnAddStudent').addEventListener('click', () => {
    const exam = currentExam(), tpl = currentTpl();
    if (!exam || !tpl) { toast('请先选择考试', 'err'); return; }
    const scores = {};
    tpl.questions.forEach(q => scores[q.qid] = 0);
    exam.students.push({ id: uid(), name: '新学生' + (exam.students.length + 1), no: '', scores });
    saveExamsSilent(); renderScoreTable(); updateDirtyAnalyze();
  });
  // 暴露到 window，便于按需排查与控制台调试
  window.state = state;
  window.WIZ = WIZ;
  renderHome();
}
initAll();