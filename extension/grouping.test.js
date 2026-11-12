'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./grouping.js');

const NOW = '2026-11-12T00:00:00.000Z';

function freshState() {
  return g.loadSemanticState({}, () => NOW).semanticGroups;
}

function ctx(state, extra = {}) {
  return {
    groups: state.groups,
    assignments: state.assignments,
    disabledBuiltinKeys: state.disabledBuiltinKeys,
    ...extra,
  };
}

test('拖放类型是约定的自定义 MIME', () => {
  assert.equal(g.DRAG_MIME, 'application/x-tab-out-url');
});

test('组名转义后不能当成 HTML 执行', () => {
  const html = g.escapeHtml('<img src=x onerror="alert(1)">');
  assert.equal(html.includes('<'), false);
  assert.equal(html.includes('>'), false);
  assert.match(html, /&lt;img/);
  assert.match(html, /&quot;/);
});

test('规范化网址去掉追踪参数、hash 和用户信息', () => {
  assert.equal(
    g.normalizeAssignmentUrl('https://www.YouTube.com/watch?v=abc&utm_source=x#t=1'),
    'https://www.youtube.com/watch?v=abc'
  );
  assert.equal(
    g.normalizeAssignmentUrl('https://github.com/foo/bar/'),
    'https://github.com/foo/bar'
  );
  assert.equal(g.normalizeAssignmentUrl('HTTPS://GitHub.com'), 'https://github.com/');
  assert.equal(
    g.normalizeAssignmentUrl('https://x.com/home?b=1&a=2'),
    'https://x.com/home?a=2&b=1'
  );
  assert.equal(
    g.normalizeAssignmentUrl('https://user:pass@example.com/a/'),
    'https://example.com/a'
  );
  assert.equal(g.normalizeAssignmentUrl('file:///tmp/a#1'), 'file:///tmp/a');
  assert.equal(g.normalizeAssignmentUrl('not a url'), null);
});

test('歧义例子表的每一行都按 groupId 和 source 分类', () => {
  const state = freshState();
  const rows = [
    ['https://github.com/', 'GitHub', 'builtin-dev', 'host'],
    ['https://www.github.com/', 'GitHub', 'builtin-dev', 'host'],
    ['https://chatgpt.com/c/1', 'Chat', 'builtin-ai', 'host'],
    ['https://claude.ai/chat', 'Claude', 'builtin-ai', 'host'],
    ['https://gemini.google.com/app', 'Gemini', 'builtin-ai', 'host'],
    ['https://grok.com/', 'Grok', 'builtin-ai', 'host'],
    ['https://cursor.com/', 'Cursor', 'builtin-ai', 'host'],
    ['https://figma.com/file/x', 'ChatGPT file', 'builtin-design', 'host'],
    ['https://www.canva.com/design', 'Canva', 'builtin-design', 'host'],
    ['https://www.pinterest.com/pin/1', 'Pin', 'builtin-design', 'host'],
    ['https://dribbble.com/shots/1', 'Shot', 'builtin-design', 'host'],
    ['https://news.example/a', 'Notes on ChatGPT', 'builtin-ai', 'title'],
    ['https://news.example/a', 'Email settings', 'builtin-other', 'other'],
    ['https://news.example/a', 'Python 教程', 'builtin-study', 'title'],
    ['https://www.coursera.org/learn/a', 'Course', 'builtin-study', 'host'],
    ['https://www.xuetangx.com/course/a', '学堂在线', 'builtin-study', 'host'],
    ['https://stackoverflow.com/questions/1', 'Question', 'builtin-dev', 'host'],
    ['https://vercel.com/dashboard', 'Vercel', 'builtin-dev', 'host'],
    ['https://my-app.vercel.app/', 'App', 'builtin-other', 'other'],
    ['https://www.zhipin.com/web/geek/job', 'BOSS', 'builtin-jobs', 'host'],
    ['https://www.liepin.com/job/1', '猎聘', 'builtin-jobs', 'host'],
    ['https://www.linkedin.com/', 'LinkedIn', 'builtin-jobs', 'host'],
    ['https://www.linkedin.com/learning/a', 'Learning', 'builtin-jobs', 'host'],
    ['https://www.notion.so/page', 'Notion', 'builtin-notes', 'host'],
    ['https://www.evernote.com/client', 'Evernote', 'builtin-notes', 'host'],
    ['https://www.yinxiang.com/evernote', '印象笔记', 'builtin-notes', 'host'],
    ['https://publish.obsidian.md/note', 'Note', 'builtin-notes', 'host'],
    ['https://blog.example/a', 'Obsidian tips', 'builtin-notes', 'title'],
    ['https://github.com/foo', 'Obsidian plugin', 'builtin-dev', 'host'],
    ['https://docs.google.com/document/d/abc', 'Doc', 'builtin-office', 'host'],
    ['https://docs.google.com/spreadsheets/d/abc', 'Sheet', 'builtin-office', 'host'],
    ['https://calendar.google.com/calendar/u/0/r', 'Calendar', 'builtin-office', 'host'],
    ['https://mail.google.com/mail/u/0/#inbox', 'Inbox', 'builtin-office', 'host'],
    ['https://mail.google.com/mail/u/0/#inbox/FMfc', 'Thread', 'builtin-office', 'host'],
    ['https://www.feishu.cn/drive', '飞书', 'builtin-office', 'host'],
    ['https://docs.qq.com/doc/abc', '腾讯文档', 'builtin-office', 'host'],
    ['https://www.xiaohongshu.com/explore', '小红书', 'builtin-social', 'host'],
    ['https://x.com/home', 'Home', 'builtin-social', 'host'],
    ['https://weibo.com/u/1', 'Weibo', 'builtin-social', 'host'],
    ['https://www.youtube.com/', 'YouTube', 'builtin-video', 'host'],
    ['https://youtube.com/', 'YouTube', 'builtin-video', 'host'],
    ['https://www.youtube.com/watch?v=1', 'Python 教程', 'builtin-video', 'host'],
    ['https://www.youtube.com/watch?v=1', 'of course the concert', 'builtin-video', 'host'],
    ['https://www.bilibili.com/video/BV1', '视频', 'builtin-video', 'host'],
    ['https://item.taobao.com/item.htm', '淘宝', 'builtin-shopping', 'host'],
    ['https://item.jd.com/1.html', '京东', 'builtin-shopping', 'host'],
    ['https://www.amazon.com/dp/1', 'Amazon', 'builtin-shopping', 'host'],
    ['http://localhost:5173/', 'Dev', 'builtin-dev', 'host'],
    ['file:///tmp/a', 'file', 'builtin-other', 'other'],
    ['https://arxiv.org/abs/1', 'Paper', 'builtin-other', 'other'],
  ];

  for (const [url, title, groupId, source] of rows) {
    const got = g.classifyTab({ url, title }, ctx(state));
    assert.deepEqual(got, { groupId, source }, `${url} / ${title}`);
  }

  const landing = g.classifyTab(
    { url: 'https://example.com/home', title: 'Home' },
    ctx(state, { landingPatterns: [{ hostname: 'example.com', pathExact: ['/home'] }] })
  );
  assert.deepEqual(landing, { groupId: '__landing-pages__', source: 'landing' });

  const socialOff = g.deleteGroup(state, 'builtin-social').state;
  const xHome = g.classifyTab({ url: 'https://x.com/home', title: 'Home' }, ctx(socialOff));
  assert.deepEqual(xHome, { groupId: '__landing-pages__', source: 'landing' });

  const manualState = g.assignUrl(state, 'https://github.com/', 'builtin-design').state;
  const manual = g.classifyTab({ url: 'https://github.com/', title: '别的标题' }, ctx(manualState));
  assert.deepEqual(manual, { groupId: 'builtin-design', source: 'manual' });
});

test('手动指定在标题改变后仍然有效', () => {
  const state = g.assignUrl(freshState(), 'https://github.com/foo', 'builtin-design').state;
  const first = g.classifyTab({ url: 'https://github.com/foo', title: 'GitHub' }, ctx(state));
  const second = g.classifyTab({ url: 'https://github.com/foo', title: '完全不同' }, ctx(state));
  assert.deepEqual(first, { groupId: 'builtin-design', source: 'manual' });
  assert.deepEqual(second, first);
});

test('停用 AI 平台后 ChatGPT 归入其他，不改投学习课程', () => {
  const state = g.deleteGroup(freshState(), 'builtin-ai').state;
  const plain = g.classifyTab({ url: 'https://chatgpt.com/', title: 'ChatGPT' }, ctx(state));
  const tutorial = g.classifyTab({ url: 'https://chatgpt.com/', title: 'ChatGPT 教程' }, ctx(state));
  assert.deepEqual(plain, { groupId: 'builtin-other', source: 'other' });
  assert.deepEqual(tutorial, { groupId: 'builtin-other', source: 'other' });
});

test('分数相同的注入规则按类别顺序，AI 平台优先于开发工具', () => {
  const state = freshState();
  const got = g.classifyTab(
    { url: 'https://github.com/', title: 'GitHub' },
    ctx(state, {
      rules: g.BUILTIN_RULES.concat([{ kind: 'host', category: 'ai', host: 'github.com' }]),
    })
  );
  assert.deepEqual(got, { groupId: 'builtin-ai', source: 'host' });
});

test('没有主机规则时，主机加标题规则优先于仅标题', () => {
  const state = freshState();
  const got = g.classifyTab(
    { url: 'https://example.com/a', title: '教程 ChatGPT' },
    ctx(state, {
      rules: [
        { kind: 'host-title', category: 'study', host: 'example.com', keywords: ['教程'] },
        { kind: 'title', category: 'ai', keywords: ['chatgpt'] },
      ],
    })
  );
  assert.deepEqual(got, { groupId: 'builtin-study', source: 'host-title' });
});

test('内置主机规则在不同类别之间不重叠', () => {
  const hosted = g.BUILTIN_RULES.filter(rule => rule.host);
  for (let i = 0; i < hosted.length; i += 1) {
    for (let j = i + 1; j < hosted.length; j += 1) {
      if (hosted[i].category === hosted[j].category) continue;
      const a = hosted[i].host.toLowerCase();
      const b = hosted[j].host.toLowerCase();
      const overlap = a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
      assert.equal(overlap, false, `${a} 与 ${b} 重叠`);
    }
  }
});

test('email 不进 AI，YouTube 上的教程和 of course 都留在视频娱乐', () => {
  const state = freshState();
  assert.deepEqual(
    g.classifyTab({ url: 'https://news.example/settings', title: 'Email settings' }, ctx(state)),
    { groupId: 'builtin-other', source: 'other' }
  );
  assert.deepEqual(
    g.classifyTab({ url: 'https://www.youtube.com/watch?v=1', title: 'of course the concert' }, ctx(state)),
    { groupId: 'builtin-video', source: 'host' }
  );
  assert.deepEqual(
    g.classifyTab({ url: 'https://www.youtube.com/watch?v=1', title: 'Python 教程' }, ctx(state)),
    { groupId: 'builtin-video', source: 'host' }
  );
  assert.deepEqual(
    g.classifyTab({ url: 'https://news.example/learn', title: 'Python 教程' }, ctx(state)),
    { groupId: 'builtin-study', source: 'title' }
  );
});

test('没有 semanticGroups 时只准备新键，不改动 deferred', () => {
  const deferred = [{ id: '1', url: 'https://example.com' }];
  const storage = { deferred };
  const loaded = g.loadSemanticState(storage, () => NOW);
  assert.deepEqual(storage.deferred, deferred);
  assert.equal(storage.deferred[0], deferred[0]);
  assert.equal(loaded.deferred, undefined);
  assert.equal(loaded.persist, true);
  assert.equal(loaded.writable, true);
  assert.equal(loaded.semanticGroups.version, 1);
  assert.equal(loaded.semanticGroups.groups.length, 11);
  assert.deepEqual(loaded.semanticGroups.assignments, {});
  assert.deepEqual(loaded.semanticGroups.disabledBuiltinKeys, []);
});

test('完整的 version 1 原样读回，不需要写回', () => {
  const state = freshState();
  state.groups.find(group => group.id === 'builtin-ai').name = '智能';
  state.assignments['https://github.com/foo/bar'] = 'builtin-design';
  const loaded = g.loadSemanticState({ semanticGroups: state }, () => '2099-01-01T00:00:00.000Z');
  assert.equal(loaded.persist, false);
  assert.equal(loaded.writable, true);
  assert.equal(loaded.semanticGroups.groups.find(group => group.id === 'builtin-ai').name, '智能');
  assert.equal(loaded.semanticGroups.assignments['https://github.com/foo/bar'], 'builtin-design');
});

test('认不出的版本不会写回', () => {
  const version2 = g.loadSemanticState({ semanticGroups: { version: 2, groups: [] } });
  assert.equal(version2.persist, false);
  assert.equal(version2.writable, false);
  assert.equal(version2.semanticGroups.groups.length, 11);

  const text = g.loadSemanticState({ semanticGroups: 'nope' });
  assert.equal(text.persist, false);
  assert.equal(text.writable, false);

  const list = g.loadSemanticState({ semanticGroups: [] });
  assert.equal(list.writable, false);
});

test('指向不存在分组的指定在加载时被去掉', () => {
  const state = freshState();
  state.assignments['https://example.com/a'] = 'user-missing';
  const loaded = g.loadSemanticState({ semanticGroups: state });
  assert.equal(loaded.semanticGroups.assignments['https://example.com/a'], undefined);
  assert.equal(loaded.persist, true);
  assert.equal(loaded.writable, true);
});

test('删除用户组和停用内置组都不产生要关闭的标签', () => {
  let state = freshState();
  state = g.createGroup(state, '临时', { randomUUID: () => 'temp', now: () => NOW }).state;
  const userId = 'user-temp';
  state = g.assignUrl(state, 'https://example.com/a', userId).state;
  state = g.assignUrl(state, 'https://chatgpt.com/', 'builtin-ai').state;

  const removed = g.deleteGroup(state, userId);
  assert.deepEqual(removed.closedTabIds, []);
  assert.equal(removed.state.groups.some(group => group.id === userId), false);
  assert.equal(removed.state.assignments[g.normalizeAssignmentUrl('https://example.com/a')], undefined);

  const disabled = g.deleteGroup(removed.state, 'builtin-ai');
  assert.deepEqual(disabled.closedTabIds, []);
  assert.ok(disabled.state.groups.some(group => group.id === 'builtin-ai'));
  assert.ok(disabled.state.disabledBuiltinKeys.includes('ai'));
  assert.equal(disabled.state.assignments[g.normalizeAssignmentUrl('https://chatgpt.com/')], undefined);

  const other = g.deleteGroup(disabled.state, 'builtin-other');
  assert.equal(other.state, disabled.state);
  assert.deepEqual(other.closedTabIds, []);
});

test('恢复默认分组保留用户组和改过的名称，不恢复被清掉的指定', () => {
  let state = freshState();
  state = g.renameGroup(state, 'builtin-ai', '智能', () => NOW).state;
  state = g.createGroup(state, '我的', { randomUUID: () => 'mine', now: () => NOW }).state;
  state = g.assignUrl(state, 'https://example.com/kept', 'user-mine').state;
  state = g.assignUrl(state, 'https://chatgpt.com/', 'builtin-ai').state;
  state = g.deleteGroup(state, 'builtin-ai').state;

  const restored = g.restoreDefaultGroups(state, () => NOW);
  assert.deepEqual(restored.state.disabledBuiltinKeys, []);
  assert.equal(restored.state.groups.find(group => group.id === 'builtin-ai').name, '智能');
  assert.ok(restored.state.groups.some(group => group.id === 'user-mine'));
  assert.equal(
    restored.state.assignments[g.normalizeAssignmentUrl('https://example.com/kept')],
    'user-mine'
  );
  assert.equal(restored.state.assignments[g.normalizeAssignmentUrl('https://chatgpt.com/')], undefined);
  assert.equal(restored.closedTabIds, undefined);
});

test('重名、空白名称和第 31 个用户组都不会改状态', () => {
  const state = freshState();
  const duplicate = g.createGroup(state, 'AI 平台');
  assert.equal(duplicate.state, state);
  assert.equal(duplicate.error, '已经有同名分组');

  const blank = g.createGroup(state, '   ');
  assert.equal(blank.state, state);
  assert.equal(blank.error, '分组名称无效');

  const first = g.createGroup(state, '第一', { randomUUID: () => '1', now: () => NOW });
  assert.equal(first.state.groups.find(group => group.id === 'user-1').order, 11);

  let current = state;
  for (let i = 0; i < 30; i += 1) {
    current = g.createGroup(current, '组' + i, { randomUUID: () => String(i), now: () => NOW }).state;
  }
  assert.equal(current.groups.filter(group => group.kind === 'user').length, 30);
  const overflow = g.createGroup(current, '超出');
  assert.equal(overflow.state, current);
  assert.equal(overflow.error, '分组数量已达上限');

  const renamed = g.renameGroup(first.state, 'user-1', '开发工具');
  assert.equal(renamed.state, first.state);
  assert.equal(renamed.error, '已经有同名分组');
});

test('自定义分组只接收前面步骤没有收下的网址', () => {
  const state = freshState();
  const custom = g.classifyTab(
    { url: 'https://notes.example/a', title: 'Hi' },
    ctx(state, { customGroups: [{ hostname: 'notes.example', groupKey: 'mine', groupLabel: 'Mine' }] })
  );
  assert.deepEqual(custom, { groupId: 'custom:mine', source: 'custom' });

  const github = g.classifyTab(
    { url: 'https://github.com/foo', title: 'Repo' },
    ctx(state, { customGroups: [{ hostname: 'github.com', groupKey: 'mine', groupLabel: 'Mine' }] })
  );
  assert.deepEqual(github, { groupId: 'builtin-dev', source: 'host' });
});

test('卡片顺序是十个语义组、用户组，最后是其他', () => {
  let state = freshState();
  state = g.createGroup(state, '我的', { randomUUID: () => 'mine', now: () => NOW }).state;
  state = g.deleteGroup(state, 'builtin-design').state;
  assert.deepEqual(g.orderedGroupIds(state), [
    'builtin-ai',
    'builtin-study',
    'builtin-dev',
    'builtin-jobs',
    'builtin-notes',
    'builtin-office',
    'builtin-social',
    'builtin-video',
    'builtin-shopping',
    'user-mine',
    'builtin-other',
  ]);
});
