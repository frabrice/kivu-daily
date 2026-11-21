/* Kivu Daily · App UIs screen player.
   Runs one exported design screen on its own: {{ holes }}, onClick, style
   objects, <sc-if> blocks and setState. Talks to the App UIs page around it
   (postMessage) for navigation, swipe-back and the status-bar colour. */
(function () {
  var MSG = 'kd-app-ui';
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var p = typeof patch === 'function' ? patch(this.state) : patch;
    for (var k in p) this.state[k] = p[k];
    render();
  };
  DCLogic.prototype.renderVals = function () { return {}; };
  window.DCLogic = DCLogic;

  var inst = null, tpl = '', root = null, screenId = '';
  function css(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    var out = [];
    for (var k in v) {
      if (v[k] == null || v[k] === false) continue;
      out.push(k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }) + ':' + v[k]);
    }
    return out.join(';');
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function render() {
    var vals = inst ? inst.renderVals() || {} : {};
    var html = tpl.replace(/<sc-if value="\{\{\s*(\w+)\s*\}\}"[^>]*>([\s\S]*?)<\/sc-if>/g, function (_, k, inner) { return vals[k] ? inner : ''; });
    html = html.replace(/style="\{\{\s*(\w+)\s*\}\}"/g, function (_, k) { return 'style="' + esc(css(vals[k])) + '"'; });
    html = html.replace(/onClick="\{\{\s*(\w+)\s*\}\}"/g, function (_, k) { return 'data-dc-on="' + k + '"'; });
    html = html.replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, k) { return vals[k] == null ? '' : esc(vals[k]); });
    // keep inner scroll positions across re-renders
    var scrolls = [];
    if (root.firstChild) root.querySelectorAll('*').forEach(function (el, i) { if (el.scrollTop) scrolls.push([i, el.scrollTop]); });
    root.innerHTML = html;
    if (scrolls.length) { var all = root.querySelectorAll('*'); scrolls.forEach(function (s) { if (all[s[0]]) all[s[0]].scrollTop = s[1]; }); }
    root.querySelectorAll('[data-dc-on]').forEach(function (el) {
      var fn = vals[el.getAttribute('data-dc-on')];
      if (typeof fn === 'function') el.addEventListener('click', function (e) { e.preventDefault(); fn(); });
    });
  }

  function post(msg) { msg.kind = MSG; msg.screen = screenId; try { window.parent.postMessage(msg, '*'); } catch (e) {} }

  function topColor() {
    var el = document.elementFromPoint(195, 3);
    while (el && el !== document.documentElement) {
      var c = getComputedStyle(el);
      if (el.tagName === 'IMG') return 'rgb(20, 35, 58)';
      if (c.backgroundColor && c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== 'transparent') return c.backgroundColor;
      if (c.backgroundImage && c.backgroundImage !== 'none') return 'rgb(20, 35, 58)';
      el = el.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }

  function pinBottomBars() {
    // Long pages: their bottom action bar should stay on screen, like a real phone.
    var page = root.firstElementChild; if (!page) return;
    Array.prototype.forEach.call(page.children, function (el) {
      var s = el.style;
      if (s.position === 'absolute' && s.bottom !== '' && (s.top === '' || s.top === 'auto')) { s.position = 'fixed'; s.zIndex = s.zIndex || '20'; if (!s.left) s.left = '0'; if (!s.right) s.right = '0'; }
    });
  }

  window.DC = {
    boot: function (id, tall) {
      screenId = id; root = document.getElementById('dc-root');
      tpl = document.getElementById('dc-tpl').textContent;
      if (tall) document.documentElement.setAttribute('data-tall', '1');
      /* global Component */
      try { if (typeof Component === 'function') inst = new Component({}); } catch (e) { inst = null; }
      render();
      if (tall) pinBottomBars();
      setTimeout(function () { post({ type: 'screen', top: topColor() }); }, 30);

      document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a');
        if (!a) return;
        var href = a.getAttribute('href') || '';
        if (a.hasAttribute('data-missing') || href.indexOf('tel:') === 0 || href.indexOf('mailto:') === 0 || href.indexOf('http') === 0) { e.preventDefault(); return; }
        if (/^[A-Za-z]+\.html$/.test(href)) { e.preventDefault(); post({ type: 'go', to: href.replace('.html', '') }); }
      }, true);

      // Swipe back from the left edge, like iOS.
      var sx = null, sy = 0;
      document.addEventListener('pointerdown', function (e) { if (e.clientX < 28) { sx = e.clientX; sy = e.clientY; } else sx = null; });
      document.addEventListener('pointermove', function (e) { if (sx != null) post({ type: 'drag', dx: Math.max(0, e.clientX - sx) }); });
      document.addEventListener('pointerup', function (e) {
        if (sx == null) return;
        var dx = e.clientX - sx, dy = Math.abs(e.clientY - sy); sx = null;
        post({ type: dx > 80 && dy < 120 ? 'back' : 'drag-end' });
      });
      document.addEventListener('keydown', function (e) {
        if (/INPUT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return;
        post({ type: 'key', key: e.key });
      });
    },
  };
})();
