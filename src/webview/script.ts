export function getScript(): string {
  return `
(function() {
  var placeholder = document.getElementById('placeholder');
  var content = document.getElementById('content');
  var loading = document.getElementById('loading');
  var copyRow = document.getElementById('copy-row');
  var copyBtn = document.getElementById('copy-btn');
  var statusBadge = document.getElementById('status-badge');
  var statusText = document.getElementById('status-text');
  var infoCard = document.getElementById('symbol-info');
  var infoKind = document.getElementById('info-symbol-kind');
  var infoLocation = document.getElementById('info-symbol-location');
  var infoLineCol = document.getElementById('info-symbol-linecol');
  var statusDetail = document.getElementById('status-detail');
  var symbolSignature = document.getElementById('symbol-signature');
  var body = document.body;
  var heroTitle = document.getElementById('hero-title');
  var heroSubtitle = document.getElementById('hero-subtitle');
  var srAnnounce = document.getElementById('sr-announce');

  var IDLE_TITLE = 'Symbol Explanation';
  var IDLE_SUBTITLE = 'Select a symbol and press Ctrl+Alt+E';

  var UI_STATES = {
    IDLE: 'idle',
    LOADING: 'loading',
    STREAMING: 'streaming',
    READY: 'ready',
    ERROR: 'error'
  };

  var STATE_TRANSITIONS = {
    idle: ['loading'],
    loading: ['streaming', 'ready', 'error', 'idle'],
    streaming: ['ready', 'error'],
    ready: ['loading', 'idle'],
    error: ['loading', 'idle']
  };

  var currentUIState = UI_STATES.IDLE;

  function canTransition(from, to) {
    var allowed = STATE_TRANSITIONS[from];
    return allowed && allowed.indexOf(to) !== -1;
  }

  function transitionTo(newState) {
    if (!canTransition(currentUIState, newState)) {
      console.warn('Invalid UI state transition:', currentUIState, '->', newState);
      return false;
    }
    currentUIState = newState;
    body.setAttribute('data-ui-state', newState);
    return true;
  }

  if (body) body.setAttribute('data-ui-state', UI_STATES.IDLE);

  function announce(message) {
    if (srAnnounce) {
      srAnnounce.textContent = message;
      setTimeout(function() { srAnnounce.textContent = ''; }, 100);
    }
  }

  var vsCodeApi = typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : { postMessage: function() {} };

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function show(el) {
    if (el) el.classList.remove('hidden');
  }

  function hide(el) {
    if (el) el.classList.add('hidden');
  }

  function slug(text) {
    var s = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return s || 'h';
  }

  function setHeroIdle() {
    if (heroTitle) heroTitle.textContent = IDLE_TITLE;
    if (heroSubtitle) heroSubtitle.innerHTML = 'Select a symbol and press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>E</kbd>';
  }

  function setHeroReport(name, kind, location) {
    if (heroTitle) heroTitle.textContent = name || '—';
    if (heroSubtitle) {
      var kindBadge = kind ? '<span class="kind-pill ' + kind.toLowerCase() + '">' + esc(kind) + '</span>' : '';
      var loc = location ? ' · ' + esc(location) : '';
      heroSubtitle.innerHTML = kindBadge + loc;
    }
  }

  function setBadgeState(state) {
    if (!statusBadge) return;
    statusBadge.classList.remove('idle', 'working', 'ready', 'error');
    statusBadge.classList.add(state);
  }

  var pendingScroll = false;
  var currentSymbolKey = '';

  function scrollToBottom() {
    if (!content || pendingScroll) return;
    pendingScroll = true;
    requestAnimationFrame(function() {
      pendingScroll = false;
      if (content) content.scrollTop = content.scrollHeight;
    });
  }

  function saveScrollPosition() {
    if (!content || !currentSymbolKey) return;
    try {
      sessionStorage.setItem('dw-scroll-' + currentSymbolKey, String(content.scrollTop));
    } catch (e) {}
  }

  function restoreScrollPosition() {
    if (!content || !currentSymbolKey) return;
    try {
      var saved = sessionStorage.getItem('dw-scroll-' + currentSymbolKey);
      if (saved) {
        var pos = parseInt(saved, 10);
        if (!isNaN(pos)) content.scrollTop = pos;
      }
    } catch (e) {}
  }

  if (content) {
    var scrollSaveTimeout;
    content.addEventListener('scroll', function() {
      clearTimeout(scrollSaveTimeout);
      scrollSaveTimeout = setTimeout(saveScrollPosition, 200);
    });
  }

  function showContent() { show(content); }
  function hideContent() { hide(content); }
  function resetContent() {
    if (content) content.innerHTML = '';
  }

  function setStatus(text, badge) {
    if (statusText) statusText.textContent = text;
    if (statusBadge && typeof badge === 'string') {
      statusBadge.textContent = badge;
      var state = badge.toLowerCase();
      if (state === 'idle' || state === 'ready') setBadgeState(state);
      else if (state === 'working' || state === 'analyzing') setBadgeState('working');
      else if (state === 'error') setBadgeState('error');
    }
  }

  function setStatusDetail(text) {
    if (!statusDetail) return;
    if (text) {
      statusDetail.textContent = text;
      statusDetail.classList.remove('hidden');
    } else {
      statusDetail.textContent = '';
      statusDetail.classList.add('hidden');
    }
  }

  function setReportActive(active) {
    if (!body) return;
    body.classList.toggle('report-active', !!active);
  }

  function updateTocAndHeadings(container) {
    if (!container) return;
    var headings = container.querySelectorAll('h2, h3, h4');
    var used = {};
    for (var i = 0; i < headings.length; i++) {
      var h = headings[i];
      var text = (h.textContent || '').trim();
      var base = slug(text) || 'h-' + i;
      var id = base;
      var n = 0;
      while (used[id]) { n++; id = base + '-' + n; }
      used[id] = true;
      h.id = id;
    }
  }

  function addCodeBlockCopyButtons(container) {
    if (!container) return;
    var pres = container.querySelectorAll('pre');
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      if (pre.parentElement && pre.parentElement.classList.contains('pre-wrapper')) continue;
      
      var wrapper = document.createElement('div');
      wrapper.className = 'pre-wrapper';
      
      var code = pre.querySelector('code');
      var lang = '';
      if (code && code.className) {
        var match = code.className.match(/language-(\\w+)/);
        if (match) lang = match[1];
      }
      
      var header = document.createElement('div');
      header.className = 'pre-header';
      var langSpan = document.createElement('span');
      langSpan.className = 'pre-lang';
      langSpan.textContent = lang || 'code';
      var btn = document.createElement('button');
      btn.className = 'pre-copy';
      btn.textContent = 'Copy';
      btn.type = 'button';
      header.appendChild(langSpan);
      header.appendChild(btn);
      wrapper.appendChild(header);
      var parent = pre.parentNode;
      var next = pre.nextSibling;
      wrapper.appendChild(pre);
      parent.insertBefore(wrapper, next);
    }
  }

  function animateCopyButton(button, originalContent) {
    var original = originalContent || button.innerHTML;
    button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
    button.style.pointerEvents = 'none';
    
    setTimeout(function() {
      button.innerHTML = original;
      button.style.pointerEvents = '';
    }, 1500);
  }

  if (copyBtn) {
    var copyBtnOriginal = copyBtn.innerHTML;
    copyBtn.addEventListener('click', function() {
      try {
        var text = (content && content.innerText) || '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function() {
            animateCopyButton(copyBtn, copyBtnOriginal);
          });
        }
      } catch (e) {}
    });
  }

  if (content) {
    content.addEventListener('click', function(ev) {
      var copyBtnEl = ev.target && ev.target.closest ? ev.target.closest('.pre-copy') : null;
      if (copyBtnEl) {
        var wrap = copyBtnEl.parentElement.parentElement;
        var pre = wrap ? wrap.querySelector('pre') : null;
        var text = pre ? pre.textContent : '';
        if (navigator.clipboard && navigator.clipboard.writeText && text) {
          navigator.clipboard.writeText(text).then(function() {
            var prev = copyBtnEl.textContent;
            copyBtnEl.textContent = 'Copied!';
            copyBtnEl.setAttribute('data-copied', 'true');
            announce('Code copied to clipboard');
            setTimeout(function() {
              copyBtnEl.textContent = prev;
              copyBtnEl.removeAttribute('data-copied');
            }, 1500);
          });
        }
        ev.preventDefault();
        return;
      }
      
      var a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
      if (!a || !a.href) return;
      
      var h = a.getAttribute('href') || '';
      
      if (a.hasAttribute('data-dw-path')) {
        ev.preventDefault();
        var p = a.getAttribute('data-dw-path') || '';
        var ln = a.getAttribute('data-dw-line');
        var cl = a.getAttribute('data-dw-col');
        var lnEnd = a.hasAttribute('data-dw-line-end')
          ? parseInt(a.getAttribute('data-dw-line-end'), 10)
          : undefined;
        vsCodeApi.postMessage({
          type: 'openFile',
          path: p,
          line: ln ? parseInt(ln, 10) : undefined,
          col: cl ? parseInt(cl, 10) : undefined,
          endLine: lnEnd
        });
        return;
      }

      if (a.hasAttribute('data-dw-symbol')) {
        ev.preventDefault();
        var sym = a.getAttribute('data-dw-symbol') || '';
        if (sym) vsCodeApi.postMessage({ type: 'goToSymbol', symbol: sym });
        return;
      }

      if (h.charAt(0) === '#') {
        ev.preventDefault();
        var id = h.slice(1).split('?')[0];
        var el = id ? document.getElementById(id) : null;
        if (el) {
          el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } else if (id) {
          var sym = (a.textContent || '').trim();
          if (sym) vsCodeApi.postMessage({ type: 'goToSymbol', symbol: sym });
        }
        return;
      }
      
      if (h.indexOf('command:symfocus.openFile?') === 0) {
        ev.preventDefault();
        var q = h.split('?')[1];
        if (q) {
          try {
            var arr = JSON.parse(decodeURIComponent(q));
            vsCodeApi.postMessage({
              type: 'openFile',
              path: arr[0],
              line: arr[1],
              col: arr[2],
              endLine: arr[3]
            });
          } catch (e) {}
        }
      }
    });
  }

  document.addEventListener('keydown', function(ev) {
    var tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    var headings = content ? content.querySelectorAll('h2, h3, h4') : [];
    var currentIndex = -1;
    if (content && headings.length > 0) {
      var st = content.scrollTop + 80;
      for (var i = 0; i < headings.length; i++) {
        if (headings[i].offsetTop <= st) currentIndex = i;
      }
    }

    switch (ev.key) {
      case 'j':
        if (headings.length > 0) {
          var next = currentIndex < headings.length - 1 ? currentIndex + 1 : 0;
          headings[next].scrollIntoView({ block: 'start', behavior: 'smooth' });
          ev.preventDefault();
        }
        break;

      case 'k':
        if (headings.length > 0) {
          var prev = currentIndex > 0 ? currentIndex - 1 : headings.length - 1;
          headings[prev].scrollIntoView({ block: 'start', behavior: 'smooth' });
          ev.preventDefault();
        }
        break;

      case 'c':
        if (ev.shiftKey && copyBtn && !copyRow.classList.contains('hidden')) {
          copyBtn.click();
          ev.preventDefault();
        }
        break;
    }
  });

  window.addEventListener('message', function(ev) {
    var d = ev.data;
    
    switch (d.type) {
      case 'loading':
        transitionTo(UI_STATES.LOADING);
        hide(placeholder);
        show(loading);
        hide(copyRow);
        hideContent();
        if (infoCard) infoCard.classList.add('hidden');
        if (symbolSignature) symbolSignature.classList.add('hidden');
        setStatus('Analyzing symbol...', 'Working');
        setBadgeState('working');
        setStatusDetail('');
        setReportActive(false);
        announce('Loading explanation, please wait');
        break;
        
      case 'clear':
        transitionTo(UI_STATES.STREAMING);
        hide(placeholder);
        hide(loading);
        hide(copyRow);
        hideContent();
        resetContent();
        if (content) updateTocAndHeadings(content);
        setStatusDetail('');
        setReportActive(false);
        break;
        
      case 'show':
        transitionTo(UI_STATES.READY);
        hide(loading);
        hide(placeholder);
        show(copyRow);
        showContent();

        if (content) {
          var html = d.html;
          requestAnimationFrame(function() {
            if (content) {
              content.innerHTML = html;
              updateTocAndHeadings(content);
              addCodeBlockCopyButtons(content);
            }
            restoreScrollPosition();
          });
        }
        setReportActive(true);
        announce('Explanation ready. Use j and k to jump between sections');
        break;
        
      case 'append':
        if (content) {
          var div = document.createElement('div');
          div.innerHTML = d.html;
          addCodeBlockCopyButtons(div);
          while (div.firstChild) content.appendChild(div.firstChild);
          updateTocAndHeadings(content);
          scrollToBottom();
        }
        setReportActive(true);
        break;
        
      case 'error':
        transitionTo(UI_STATES.ERROR);
        setHeroIdle();
        hide(loading);
        hide(placeholder);
        showContent();
        if (content) {
          content.innerHTML = '<div class="error" role="alert">' + esc(d.message) + '</div>';
          updateTocAndHeadings(content);
        }
        show(copyRow);
        setStatus(d.message || 'Error', 'Error');
        setBadgeState('error');
        setStatusDetail('');
        setReportActive(false);
        announce('Error: ' + (d.message || 'An error occurred'));
        break;
        
      case 'info':
        currentSymbolKey = (d.symbol.path || '') + ':' + (d.symbol.name || '');
        setHeroReport(d.symbol.name, d.symbol.kind, d.symbol.location);
        if (infoCard) infoCard.classList.remove('hidden');
        
        if (infoKind) {
          var kind = d.symbol.kind || '—';
          infoKind.textContent = kind;
          infoKind.className = 'kind-pill ' + kind.toLowerCase();
        }
        
        if (infoLocation) infoLocation.textContent = d.symbol.location || '—';
        
        if (infoLineCol) {
          var lineText = d.symbol.line ? 'Line ' + d.symbol.line : '';
          var colText = d.symbol.col ? 'Col ' + d.symbol.col : '';
          infoLineCol.textContent = lineText && colText
            ? lineText + ', ' + colText
            : lineText || colText || '—';
        }
        
        if (symbolSignature) {
          var sig = d.symbol.signature;
          if (sig && String(sig).trim()) {
            symbolSignature.textContent = String(sig).trim();
            symbolSignature.classList.remove('hidden');
          } else {
            symbolSignature.textContent = '';
            symbolSignature.classList.add('hidden');
          }
        }
        setStatusDetail('');
        break;
        
      case 'status':
        setStatus(d.status || '', d.badge);
        break;
    }
  });
})();
`.trim();
}
