// Markdown 輸入輔助：Orca 的 Textarea 只回報整段新值，不給游標位置與按鍵，
// 所以從「舊值 → 新值」的差異推回「剛按了一次 Enter」，再決定要不要補列表符號。

const LIST_ITEM = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?(.*)$/;

/**
 * 新值只比舊值多一個換行、且換行前那行是列表項目時：
 * - 該項有內容 → 新行補上同樣的符號（有序列表 +1、待辦一律未勾）
 * - 該項只有符號 → 拿掉符號，結束列表
 * 其他情況原樣回傳。
 */
export function continueList(prev: string, next: string): string {
  if (next.length !== prev.length + 1) return next;
  let i = 0;
  while (i < prev.length && prev[i] === next[i]) i++;
  if (next[i] !== '\n' || next.slice(i + 1) !== prev.slice(i)) return next;
  // 在既有換行旁插入換行，結果字串相同、位置有歧義；視為按在上一行的行尾（編輯列表中間最常見）。
  if (i > 0 && prev[i - 1] === '\n') i--;

  const lineStart = prev.lastIndexOf('\n', i - 1) + 1;
  const m = LIST_ITEM.exec(prev.slice(lineStart, i));
  if (!m) return next;
  const [, indent, bullet, num, delim, space, task, rest] = m;
  const lineEnd = prev.indexOf('\n', i);
  const afterCursor = prev.slice(i, lineEnd === -1 ? prev.length : lineEnd);

  if (!rest.trim() && !afterCursor.trim()) {
    return prev.slice(0, lineStart) + prev.slice(i);
  }
  const marker = bullet ?? `${Number(num) + 1}${delim}`;
  const prefix = `${indent}${marker}${space}${task ? '[ ] ' : ''}`;
  return next.slice(0, i + 1) + prefix + next.slice(i + 1);
}

const TASK_OPEN = /^\s*(?:[-*+]|\d+[.)])\s+\[$/;

/**
 * 在列表符號後打 `[`（行首到游標為 `- [`、`1. [` 這類）時補成 `[ ] `，變成待辦項目。
 * `[` 後面已經有 `]` 時不動，避免重複補。
 */
export function completeTask(prev: string, next: string): string {
  if (next.length !== prev.length + 1) return next;
  let i = 0;
  while (i < prev.length && prev[i] === next[i]) i++;
  if (next[i] !== '[' || next.slice(i + 1) !== prev.slice(i)) return next;
  const lineStart = next.lastIndexOf('\n', i) + 1;
  if (!TASK_OPEN.test(next.slice(lineStart, i + 1))) return next;
  const after = prev.slice(i);
  if (/^ ?\]/.test(after)) return next;
  return next.slice(0, i) + '[ ] ' + after.replace(/^[ \t]+/, '');
}

/** 輸入框的 Markdown 輔助：依序套用 Enter 延續列表、`[` 補成待辦。 */
export function assistMarkdown(prev: string, next: string): string {
  const listed = continueList(prev, next);
  return listed !== next ? listed : completeTask(prev, next);
}
