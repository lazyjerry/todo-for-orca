// `orca plugin check` 以真的 worker 渲染面板：空清單，以及有進行中、下一個、各狀態的假資料。
import { defineCheck } from 'orca/testing';

const now = Date.now();
const MIN = 60_000;
const base = { body: '', durationMin: 0, repeat: null, notify: true, notifiedThrough: now, createdAt: now, updatedAt: now };

export default defineCheck({
  empty: {},
  filled: {
    storage: {
      todos: {
        version: 1,
        todos: [
          { ...base, id: 'a', title: '專注時段', status: 'enabled', startAt: now - 5 * MIN, durationMin: 25, body: '## 目標\n- [ ] 寫完測試' },
          {
            ...base,
            id: 'b',
            title: '站立會議',
            status: 'enabled',
            startAt: now + 30 * MIN,
            durationMin: 15,
            repeat: { unit: 'day', every: 1, end: { kind: 'count', count: 5 } },
            project: { key: 'repo:local:/repo/todo-list', kind: 'repo', name: 'todo-list' },
          },
          { ...base, id: 'c', title: '暫停的提醒', status: 'disabled', startAt: now + 60 * MIN },
          { ...base, id: 'd', title: '已完成的事', status: 'done', startAt: null },
        ],
      },
    },
  },
});
