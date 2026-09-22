const fs = require('fs');
const src = fs.readFileSync('app.js', 'utf8');
const start = src.indexOf('function detectPoints');
const end = src.indexOf('function mergeByPoints');
const fnSrc = src.slice(src.indexOf('function detectPoints', start), end);
eval(fnSrc); // 定义 detectPoints

const cases = [
  // [输入, 期望, 说明]
  ['（本题共5小题，19分）完成1～5题。1．正确的一项是（3分）', 3, '大题总分+单题分→取单题3'],
  ['（本题共5小题，19分）', 0, '仅大题总分→不得当成单题分'],
  ['（共19分）', 0, '括号共总分→跳过'],
  ['（总计18分）', 0, '括号总计→跳过'],
  ['（本题共4小题，18分）据此完成下面小题', 0, '地理式总分→跳过'],
  ['（本题6分）', 6, '明确单题分→6'],
  ['（3分）', 3, '单题括号分→3'],
  ['2．补写出下列句子中的空缺部分。（6分）', 6, '单题分→6'],
];
let fail = 0;
for (const [input, exp, note] of cases) {
  const got = detectPoints(input);
  const ok = got === exp;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${note}  期望=${exp} 实得=${got}`);
}
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);