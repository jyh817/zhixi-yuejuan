const fs = require('fs');
const src = fs.readFileSync('app.js', 'utf8');
const s = src.indexOf('const SECTION_KNOW_HINT');
const e = src.indexOf('function mergeByPoints');
eval(src.slice(s, e)); // parsePaper / detectPoints 等

const paperText = [
  '姓名： 准考证号： 注意事项 1、本试题共150分',
  'MERRIE  VERLE  LFGKP',                 // 无中文英文幻觉 → 应过滤
  '把①把①把①把①把①垛',                  // 重复短片段 → 应过滤
  '§§§§§§',                               // 纯符号 → 应过滤
  '（一）现代文阅读（本题共5小题，19分）',
  '阅读下面的文字，完成1~5题。',
  '1．下列关于原文内容的理解和分析，正确的一项是（3分）',
  'A．惬意 qiè  B．脚踝 huái',              // 真选项 → 保留
  '2．下列对人类行为动机的表述，不正确的一项是（3分）',
  '（二）古代诗歌阅读',
  '6．下列对本诗的理解，不正确的一项是（3分）',
  '7．本诗表达了怎样的思想感情？（6分）',
  '4、考试结束后，将本试卷和答题卡一并交回。',
  'MMMM……，零零碎碎堆了满地',           // 半中文半乱码但非纯幻觉 → 保留不影响
].join('\n');
const qs = parsePaper(paperText);
console.log('--- 识别结果 ---');
qs.forEach(q => console.log(`${q.qid} fullMark=${q.fullMark} head="${(q.header || '').slice(0, 30)}"`));

let fail = 0;
const okReminder = !qs.some(q => /考试结束|交回|答题卡/.test(q.header || ''));
const okGarbEnglish = qs.every(q => !/MERRIE|VERLE|LFGKP/.test(String(q.header || '')));
const okGarbRepeat = qs.every(q => !/把①/.test(String(q.header || '')));
const okGarbSym = qs.every(q => !/§/.test(String(q.header || '')));
const f = Object.fromEntries(qs.map(q => [q.qid, q.fullMark]));
const okQ = f.Q1 === 3 && f.Q2 === 3 && f.Q3 === 3 && f.Q4 === 6;
// 选项 A 应并入 Q1 的 parts 而不单独成题
const okOptionMerged = !qs.some(q => /^A[．.、]/.test(q.header || ''));
console.log(`提醒被滤:${okReminder}  英文乱码被滤:${okGarbEnglish}  重复乱码被滤:${okGarbRepeat}  符号乱码被滤:${okGarbSym}  选项未单独成题:${okOptionMerged}  分值正确:${okQ}`);
if (!okReminder || !okGarbEnglish || !okGarbRepeat || !okGarbSym || !okOptionMerged || !okQ) fail++;
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
process.exit(fail ? 1 : 0);