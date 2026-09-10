/* Navigation is ordinary HTML; this file only adds search, copy and the small-screen menu. */
(() => {
  const input = document.querySelector('#docs-search');
  const status = document.querySelector('.search-status');
  const groups = [...document.querySelectorAll('.component-nav')];
  const links = [...document.querySelectorAll('[data-nav-item]')];
  const index = new Map((globalThis.LikeXDocsSearch ?? []).map(page => [page.id, page]));
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase('ja-JP');
  const originalOpen = groups.map(group => group.open);
  function search() {
    const query = input.value.trim();
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    let count = 0;
    for (const item of links) {
      const page = index.get(item.dataset.pageId);
      const text = normalize(page?.text ?? item.textContent);
      const match = terms.every(term => text.includes(term));
      item.hidden = !match;
      if (match) count++;
    }
    groups.forEach((group, i) => {
      const visible = [...group.querySelectorAll('[data-nav-item]')].some(item => !item.hidden);
      group.hidden = !visible;
      group.open = query ? visible : originalOpen[i];
      for (const section of group.querySelectorAll('[data-nav-section]')) {
        let sibling = section.nextElementSibling, sectionVisible = false;
        while (sibling && !sibling.hasAttribute('data-nav-section')) { sectionVisible ||= !sibling.hidden; sibling = sibling.nextElementSibling; }
        section.hidden = !sectionVisible;
      }
    });
    status.hidden = !query;
    status.textContent = query ? `${count}ページが一致` : '';
    document.querySelector('.search-empty').hidden = count !== 0;
    document.querySelector('.search-input-row kbd').hidden = !!query;
  }
  input.addEventListener('input', search);
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { input.value = ''; search(); input.blur(); event.stopPropagation(); }
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { const link = links.find(item => !item.hidden)?.querySelector('a'); if (link) link.click(); }
  });
  const menu = document.querySelector('.mobile-menu-button');
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.querySelector('.mobile-backdrop');
  function setMenu(open) {
    menu.setAttribute('aria-expanded', String(open));
    sidebar.classList.toggle('is-open', open);
    backdrop.hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
    document.querySelector('main').inert = open;
    document.querySelector('.repository-link').inert = open;
    if (open) input.focus(); else menu.focus();
  }
  menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
  backdrop.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    const editing = event.target.closest('input, textarea, select, [contenteditable="true"]');
    if (event.key === '/' && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (matchMedia('(max-width: 640px)').matches) setMenu(true); else input.focus();
    }
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') setMenu(false);
    if (event.key === 'Tab' && menu.getAttribute('aria-expanded') === 'true') {
      const focusable = [menu, ...sidebar.querySelectorAll('input, summary, a')].filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  matchMedia('(max-width: 640px)').addEventListener('change', event => { if (!event.matches && menu.getAttribute('aria-expanded') === 'true') setMenu(false); });
  let copyTimer;
  const copyStatus = document.querySelector('.copy-status');
  for (const button of document.querySelectorAll('[data-copy-code]')) button.addEventListener('click', async () => {
    const code = button.closest('.code-example').querySelector('code');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(code.textContent);
      copyStatus.textContent = 'コードをコピーしました';
    } catch {
      const range = document.createRange(); range.selectNodeContents(code);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      copyStatus.textContent = 'コードを選択しました。Ctrl/Cmd+Cでコピーできます';
    }
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copyStatus.textContent = ''; }, 4000);
  });
})();
