'use strict';

/* ================================================================
   Tab Out — Internationalization

   Supported locales: en, zh-CN, zh-TW, ja, ko
   Add new locales by copying the 'en' block and translating values.
   Fallback is always 'en'.
   ================================================================ */

const I18N_MESSAGES = {

  en: {
    // Greetings
    greeting_morning:   'Good morning',
    greeting_afternoon: 'Good afternoon',
    greeting_evening:   'Good evening',

    // Section headers
    section_open_tabs:  'Tab Management',
    saved_for_later:    'Saved for later',

    // Domain cards
    homepages:          'Homepages',
    tabs_open:          n => `${n} tab${n !== 1 ? 's' : ''} open`,
    duplicates_badge:   n => `${n} duplicate${n !== 1 ? 's' : ''}`,
    close_all_tabs:     n => `Close all ${n} tab${n !== 1 ? 's' : ''}`,
    close_duplicates:   n => `Close ${n} duplicate${n !== 1 ? 's' : ''}`,
    domains_count:      n => `${n} domain${n !== 1 ? 's' : ''}`,
    overflow_more:      n => `+${n} more`,

    // Chip actions
    save_for_later:     'Save for later',
    close_this_tab:     'Close this tab',
    dismiss:            'Dismiss',

    // Window management
    this_window:        'This window',
    window_n:           n => `Window ${n}`,
    switch_here:        'Switch here',
    close_window:       'Close window',

    // Tab Out dupe banner
    dupe_banner:        n => `You have <strong>${n}</strong> Tab Out tabs open. Keep just this one?`,
    close_extras:       'Close extras',

    // Search
    search_placeholder: 'Search tabs...',
    no_tabs_match:      q => `No tabs match "${q}"`,

    // Empty states
    inbox_zero_title:   'Inbox zero, but for tabs.',
    inbox_zero_subtitle:"You're free.",
    nothing_saved:      'Nothing saved. Living in the moment.',

    // Saved for later
    items_count:        n => `${n} item${n !== 1 ? 's' : ''}`,
    archive:            'Archive',
    search_archive_placeholder: 'Search archived tabs...',
    no_results:         'No results',

    // Smart titles
    post_by:            user => `Post by @${user}`,
    youtube_video:      'YouTube Video',
    reddit_post:        sub => `r/${sub} post`,

    // Toast messages
    toast_tab_closed:       'Tab closed',
    toast_saved_later:      'Saved for later',
    toast_save_failed:      'Failed to save tab',
    toast_closed_dupes:     'Closed duplicates, kept one copy each',
    toast_closed_all:       'All tabs closed. Fresh start.',
    toast_closed_window:    'Closed all tabs in window',
    toast_closed_domain:    (n, label) => `Closed ${n} tab${n !== 1 ? 's' : ''} from ${label}`,
    toast_closed_tabout:    'Closed extra Tab Out tabs',

    // Time
    just_now:   'just now',
    min_ago:    n => `${n} min ago`,
    hr_ago:     n => `${n} hr${n !== 1 ? 's' : ''} ago`,
    yesterday:  'yesterday',
    days_ago:   n => `${n} days ago`,

    // Stats
    stat_open_tabs: 'Open tabs',
  },

  'zh-CN': {
    greeting_morning:   '早上好',
    greeting_afternoon: '下午好',
    greeting_evening:   '晚上好',

    section_open_tabs:  '标签页管理',
    saved_for_later:    '稍后阅读',

    homepages:          '主页',
    tabs_open:          n => `${n} 个标签页`,
    duplicates_badge:   n => `${n} 个重复`,
    close_all_tabs:     n => `关闭全部 ${n} 个`,
    close_duplicates:   n => `关闭 ${n} 个重复`,
    domains_count:      n => `${n} 个域名`,
    overflow_more:      n => `+${n} 更多`,

    save_for_later:     '保存到稍后阅读',
    close_this_tab:     '关闭此标签页',
    dismiss:            '忽略',

    this_window:        '当前窗口',
    window_n:           n => `窗口 ${n}`,
    switch_here:        '跳转',
    close_window:       '关闭窗口',

    dupe_banner:        n => `你打开了 <strong>${n}</strong> 个 Tab Out 页面，只保留这一个？`,
    close_extras:       '关闭多余',

    search_placeholder: '搜索标签页…',
    no_tabs_match:      q => `没有匹配"${q}"的标签页`,

    inbox_zero_title:   '标签页已全部清空。',
    inbox_zero_subtitle:'很清爽。',
    nothing_saved:      '暂无保存内容。',

    items_count:        n => `${n} 条`,
    archive:            '归档',
    search_archive_placeholder: '搜索归档…',
    no_results:         '无结果',

    post_by:            user => `@${user} 的帖子`,
    youtube_video:      'YouTube 视频',
    reddit_post:        sub => `r/${sub} 帖子`,

    toast_tab_closed:       '已关闭标签页',
    toast_saved_later:      '已保存到稍后阅读',
    toast_save_failed:      '保存失败',
    toast_closed_dupes:     '已关闭重复标签页，各保留一份',
    toast_closed_all:       '所有标签页已关闭。',
    toast_closed_window:    '已关闭该窗口所有标签页',
    toast_closed_domain:    (n, label) => `已关闭 ${label} 的 ${n} 个标签页`,
    toast_closed_tabout:    '已关闭多余的 Tab Out 页面',

    just_now:   '刚刚',
    min_ago:    n => `${n} 分钟前`,
    hr_ago:     n => `${n} 小时前`,
    yesterday:  '昨天',
    days_ago:   n => `${n} 天前`,

    stat_open_tabs: '标签页数',
  },

  'zh-TW': {
    greeting_morning:   '早安',
    greeting_afternoon: '午安',
    greeting_evening:   '晚安',

    section_open_tabs:  '目前分頁',
    saved_for_later:    '稍後閱讀',

    homepages:          '主頁',
    tabs_open:          n => `${n} 個分頁`,
    duplicates_badge:   n => `${n} 個重複`,
    close_all_tabs:     n => `關閉全部 ${n} 個`,
    close_duplicates:   n => `關閉 ${n} 個重複`,
    domains_count:      n => `${n} 個網域`,
    overflow_more:      n => `+${n} 更多`,

    save_for_later:     '儲存至稍後閱讀',
    close_this_tab:     '關閉此分頁',
    dismiss:            '忽略',

    this_window:        '目前視窗',
    window_n:           n => `視窗 ${n}`,
    switch_here:        '切換',
    close_window:       '關閉視窗',

    dupe_banner:        n => `你開啟了 <strong>${n}</strong> 個 Tab Out 頁面，只保留這一個？`,
    close_extras:       '關閉多餘',

    search_placeholder: '搜尋分頁…',
    no_tabs_match:      q => `沒有符合「${q}」的分頁`,

    inbox_zero_title:   '分頁已全部清空。',
    inbox_zero_subtitle:'清爽！',
    nothing_saved:      '尚無儲存內容。',

    items_count:        n => `${n} 項`,
    archive:            '封存',
    search_archive_placeholder: '搜尋封存…',
    no_results:         '無結果',

    post_by:            user => `@${user} 的貼文`,
    youtube_video:      'YouTube 影片',
    reddit_post:        sub => `r/${sub} 貼文`,

    toast_tab_closed:       '已關閉分頁',
    toast_saved_later:      '已儲存至稍後閱讀',
    toast_save_failed:      '儲存失敗',
    toast_closed_dupes:     '已關閉重複分頁，各保留一份',
    toast_closed_all:       '所有分頁已關閉。',
    toast_closed_window:    '已關閉此視窗所有分頁',
    toast_closed_domain:    (n, label) => `已從 ${label} 關閉 ${n} 個分頁`,
    toast_closed_tabout:    '已關閉多餘的 Tab Out 頁面',

    just_now:   '剛剛',
    min_ago:    n => `${n} 分鐘前`,
    hr_ago:     n => `${n} 小時前`,
    yesterday:  '昨天',
    days_ago:   n => `${n} 天前`,

    stat_open_tabs: '分頁數',
  },

  ja: {
    greeting_morning:   'おはようございます',
    greeting_afternoon: 'こんにちは',
    greeting_evening:   'こんばんは',

    section_open_tabs:  '開いているタブ',
    saved_for_later:    '後で読む',

    homepages:          'ホームページ',
    tabs_open:          n => `${n} 個のタブ`,
    duplicates_badge:   n => `重複 ${n} 個`,
    close_all_tabs:     n => `${n} 個を全て閉じる`,
    close_duplicates:   n => `重複 ${n} 個を閉じる`,
    domains_count:      n => `${n} ドメイン`,
    overflow_more:      n => `他 ${n} 件`,

    save_for_later:     '後で読む',
    close_this_tab:     'このタブを閉じる',
    dismiss:            '閉じる',

    this_window:        'このウィンドウ',
    window_n:           n => `ウィンドウ ${n}`,
    switch_here:        '切り替え',
    close_window:       'ウィンドウを閉じる',

    dupe_banner:        n => `Tab Out が <strong>${n}</strong> 個開いています。このタブだけ残しますか？`,
    close_extras:       '余分を閉じる',

    search_placeholder: 'タブを検索…',
    no_tabs_match:      q => `「${q}」に一致するタブがありません`,

    inbox_zero_title:   'タブがなくなりました。',
    inbox_zero_subtitle:'自由です。',
    nothing_saved:      '保存されたタブはありません。',

    items_count:        n => `${n} 件`,
    archive:            'アーカイブ',
    search_archive_placeholder: 'アーカイブを検索…',
    no_results:         '結果なし',

    post_by:            user => `@${user} の投稿`,
    youtube_video:      'YouTube 動画',
    reddit_post:        sub => `r/${sub} の投稿`,

    toast_tab_closed:       'タブを閉じました',
    toast_saved_later:      '後で読むに保存しました',
    toast_save_failed:      '保存に失敗しました',
    toast_closed_dupes:     '重複タブを閉じました（各1つ残）',
    toast_closed_all:       '全タブを閉じました。',
    toast_closed_window:    'ウィンドウの全タブを閉じました',
    toast_closed_domain:    (n, label) => `${label} の ${n} 個のタブを閉じました`,
    toast_closed_tabout:    '余分な Tab Out タブを閉じました',

    just_now:   'たった今',
    min_ago:    n => `${n} 分前`,
    hr_ago:     n => `${n} 時間前`,
    yesterday:  '昨日',
    days_ago:   n => `${n} 日前`,

    stat_open_tabs: '開いているタブ',
  },

  ko: {
    greeting_morning:   '좋은 아침이에요',
    greeting_afternoon: '안녕하세요',
    greeting_evening:   '안녕하세요',

    section_open_tabs:  '열린 탭',
    saved_for_later:    '나중에 읽기',

    homepages:          '홈페이지',
    tabs_open:          n => `탭 ${n}개`,
    duplicates_badge:   n => `중복 ${n}개`,
    close_all_tabs:     n => `탭 ${n}개 모두 닫기`,
    close_duplicates:   n => `중복 ${n}개 닫기`,
    domains_count:      n => `도메인 ${n}개`,
    overflow_more:      n => `${n}개 더`,

    save_for_later:     '나중에 읽기',
    close_this_tab:     '이 탭 닫기',
    dismiss:            '닫기',

    this_window:        '이 창',
    window_n:           n => `창 ${n}`,
    switch_here:        '이동',
    close_window:       '창 닫기',

    dupe_banner:        n => `Tab Out이 <strong>${n}</strong>개 열려 있습니다. 이것만 남길까요?`,
    close_extras:       '나머지 닫기',

    search_placeholder: '탭 검색…',
    no_tabs_match:      q => `"${q}"와 일치하는 탭이 없습니다`,

    inbox_zero_title:   '모든 탭이 닫혔습니다.',
    inbox_zero_subtitle:'자유롭습니다.',
    nothing_saved:      '저장된 탭이 없습니다.',

    items_count:        n => `${n}개`,
    archive:            '보관함',
    search_archive_placeholder: '보관함 검색…',
    no_results:         '결과 없음',

    post_by:            user => `@${user}의 게시물`,
    youtube_video:      'YouTube 동영상',
    reddit_post:        sub => `r/${sub} 게시물`,

    toast_tab_closed:       '탭을 닫았습니다',
    toast_saved_later:      '나중에 읽기에 저장했습니다',
    toast_save_failed:      '저장 실패',
    toast_closed_dupes:     '중복 탭을 닫았습니다 (각 1개 유지)',
    toast_closed_all:       '모든 탭을 닫았습니다.',
    toast_closed_window:    '창의 모든 탭을 닫았습니다',
    toast_closed_domain:    (n, label) => `${label}에서 탭 ${n}개를 닫았습니다`,
    toast_closed_tabout:    '불필요한 Tab Out 탭을 닫았습니다',

    just_now:   '방금',
    min_ago:    n => `${n}분 전`,
    hr_ago:     n => `${n}시간 전`,
    yesterday:  '어제',
    days_ago:   n => `${n}일 전`,

    stat_open_tabs: '열린 탭',
  },

};

/* ----------------------------------------------------------------
   Locale detection — matches navigator.language against supported
   locales, with prefix fallback (e.g. 'zh-HK' → 'zh-TW').
   ---------------------------------------------------------------- */
function detectLocale() {
  const lang = (navigator.language || 'en');

  // Exact match (case-insensitive)
  for (const key of Object.keys(I18N_MESSAGES)) {
    if (key.toLowerCase() === lang.toLowerCase()) return key;
  }

  // Prefix match: 'zh-HK' → first key starting with 'zh'
  // Prefer zh-CN for zh prefix, zh-TW for zh-TW exact (already handled above)
  const prefix = lang.split('-')[0].toLowerCase();
  for (const key of Object.keys(I18N_MESSAGES)) {
    if (key.toLowerCase().startsWith(prefix)) return key;
  }

  return 'en';
}

const LOCALE = detectLocale();

/* ----------------------------------------------------------------
   t(key, ...args) — look up a translated string.
   Values can be plain strings or functions (for plurals/interpolation).
   Always falls back to 'en'.
   ---------------------------------------------------------------- */
function t(key, ...args) {
  const msg = I18N_MESSAGES[LOCALE]?.[key] ?? I18N_MESSAGES['en']?.[key];
  if (msg === undefined) return key;
  return typeof msg === 'function' ? msg(...args) : msg;
}
