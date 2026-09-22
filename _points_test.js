const fs = require('fs');
const src = fs.readFileSync('app.js', 'utf8');
// 截取 1437 行起始的 SECTION_KNOW_HINT … knowHintOf … TYPE_KEY ... parsePaper ... detectPoints
const start = src.indexOf('const SECTION_KNOW_HINT');
const end = src.indexOf('function mergeByPoints');
const slice = src.slice(start, end);
eval(slice); // 定义 SECTION_KNOW_HINT, knowHintOf, TYPE_KEY, REFLOW_ANCHOR, reflowPaperText, parsePaper, detectPoints

const DP = [
  ['阅读(72分)', 0, '板块名短括号+大分 → 板块总分'],
  ['古代诗歌阅读(9分)', 0, '板块名短括号 → 板块总分'],
  ['（二）现代文阅读（本题共5小题，19分）', 0, '本题共X小题Y分 → 汇总'],
  ['（共19分）', 0, '共总分 → 汇总'],
  ['正确的一项是（3分）', 3, '真实小题分 → 3'],
  ['2、阅读下面的文字，完成1~5题。（6分）', 6, '长题干含“阅读”→ 保留6'],
  ['作文（60分）', 60, '作文分值 → 保留60'],
  ['（本题6分）', 6, '本题明确分 → 6'],
];
let fail = 0;
console.log('--- detectPoints 用例 ---');
for (const [inp, exp, note] of DP) {
  const got = detectPoints(inp);
  const ok = got === exp;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${note}  期望=${exp} 实得=${got}`);
}

console.log('\n--- parsePaper 集成用例（含卷首提醒 + 板块总分 + 真实小题） ---');
const paperText = [
  '姓名： 准考证号： 注意事项 1、本试题共150分',
  '（一）现代文阅读（本题共5小题，19分）',
  '阅读下面的文字，完成1~5题。',
  '1．下列关于原文内容的理解和分析，正确的一项是（3分）',
  '2．下列对材料相关内容的理解，不正确的一项是（3分）',
  '（二）古代诗歌阅读',
  '阅读下面这首古诗，完成6~7题。',
  '6．下列对本诗的理解，不正确的一项是（3分）',
  '7．本诗表达了怎样的思想感情？（6分）',
  '4、考试结束后，将本试卷和答题卡一并交回。',
].join('\n');
const qs = parsePaper(paperText);
qs.forEach((q, i) => console.log(`Q${i + 1} ${q.qid} type=${q.type} fullMark=${q.fullMark} head="${(q.header || '').slice(0, 26)}"`));
// 断言：提醒不应成题
const heads = qs.map(q => (q.header || '').join ? '' : q.header || '');
const hasReminder = qs.some(q => /考试结束|交回|答题卡/.test(q.header || '') && (q.fullMark || 0) === 0);
// 断言各题分值
const f = Object.fromEntries(qs.map(q => [q.qid, q.fullMark]));
console.log('\n期望：提醒不成题，且 Q1=3 Q2=3 Q3=3 Q4=6');
const okReminder = !hasReminder;
const okQ = f.Q1 === 3 && f.Q2 === 3 && f.Q3 === 3 && f.Q4 === 6;
const got = Object.entries(f).map(([k, v]) => `${k}=${v}`).join(' ');
console.log(`提醒被过滤: ${okReminder}   实际分值: ${got}`);
if (!okReminder || !okQ) fail++;
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);