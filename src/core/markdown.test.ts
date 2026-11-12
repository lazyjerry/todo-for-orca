import { assert, test } from 'orca/testing';
import { assistMarkdown, continueList, markdownHeading } from './markdown.ts';

const enter = (text: string, at = text.length) => continueList(text, text.slice(0, at) + '\n' + text.slice(at));

test('列表項目按 Enter 延續符號：無序、有序 +1、待辦一律未勾、保留縮排', () => {
  assert.equal(enter('- 買菜'), '- 買菜\n- ');
  assert.equal(enter('* 買菜'), '* 買菜\n* ');
  assert.equal(enter('1. 第一'), '1. 第一\n2. ');
  assert.equal(enter('9) 第九'), '9) 第九\n10) ');
  assert.equal(enter('- [x] 已完成'), '- [x] 已完成\n- [ ] ');
  assert.equal(enter('  - 子項'), '  - 子項\n  - ');
});

test('空項目按 Enter 結束列表，拿掉符號', () => {
  assert.equal(enter('- a\n- '), '- a\n');
  assert.equal(enter('- a\n- [ ] '), '- a\n');
  assert.equal(enter('1. a\n2. '), '1. a\n');
});

test('在列表中間的項目行尾按 Enter，延續在該項之後', () => {
  assert.equal(enter('- a\n- b', 3), '- a\n- \n- b');
});

test('在項目文字中間按 Enter，後半段帶符號移到新項', () => {
  assert.equal(enter('- abcd', 4), '- ab\n- cd');
});

test('非列表行、貼上多字元、刪除字元都原樣回傳', () => {
  assert.equal(enter('一般文字'), '一般文字\n');
  assert.equal(continueList('- a', '- a\nb\nc'), '- a\nb\nc');
  assert.equal(continueList('- ab', '- a'), '- a');
  assert.equal(continueList('- a', '- ab'), '- ab');
});

const typeAt = (text: string, ch: string, at = text.length) => assistMarkdown(text, text.slice(0, at) + ch + text.slice(at));

test('列表符號後打 [ 補成待辦 [ ] ：無序、有序、縮排、行中', () => {
  assert.equal(typeAt('- ', '['), '- [ ] ');
  assert.equal(typeAt('1. ', '['), '1. [ ] ');
  assert.equal(typeAt('  * ', '['), '  * [ ] ');
  assert.equal(typeAt('a\n- \nb', '[', 4), 'a\n- [ ] \nb');
  assert.equal(typeAt('- 買菜', '[', 2), '- [ ] 買菜');
});

test('[ 不在列表符號後、或後面已有 ] 時不補', () => {
  assert.equal(typeAt('', '['), '[');
  assert.equal(typeAt('看 ', '['), '看 [');
  assert.equal(typeAt('- 買', '['), '- 買[');
  assert.equal(typeAt('- ]', '[', 2), '- []');
});

test('assistMarkdown 仍會延續列表', () => {
  assert.equal(typeAt('- [ ] a', '\n'), '- [ ] a\n- [ ] ');
});

test('標題轉 h1：ASCII 標點跳脫，中文與空白不動', () => {
  assert.equal(markdownHeading('考勤研究'), '# 考勤研究');
  assert.equal(markdownHeading('修 *bug* #12 [急]'), '# 修 \\*bug\\* \\#12 \\[急\\]');
  assert.equal(markdownHeading('a_b `c` <d> & e\\f'), '# a\\_b \\`c\\` \\<d\\> \\& e\\\\f');
});
