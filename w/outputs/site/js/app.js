/* HEAT UNDERWEAR 商品展示 — 主逻辑（纯原生 JS，无依赖） */
(function () {
  'use strict';

  var CFG = window.SITE_CONFIG || {};
  var SEED = window.PRODUCTS_SEED || [];
  var IMAGES = window.PRODUCTS_IMAGES || [];
  var I18N = window.I18N || { zh: {}, es: {} };
  var SCHEMA = 2;

  var STORAGE_KEY = CFG.storageKey || 'heat_products_v1';
  var LANG_KEY = CFG.langKey || 'heat_lang';
  var QA = /[?&]qa=1/.test(location.search);
  var APP_VERSION = '20260809-7';
  var MAX_UPLOAD = 1.5 * 1024 * 1024;

  var memStore = {};
  function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return k in memStore ? memStore[k] : null; } }
  function storeSet(k, v) { memStore[k] = v; try { localStorage.setItem(k, v); } catch (e) {} }
  function storeDel(k) { delete memStore[k]; try { localStorage.removeItem(k); } catch (e) {} }

  function ghApi(path, opts) {
    var init = { method: (opts && opts.method) || 'GET', headers: {} };
    var token = (opts && opts.token) ? opts.token : (state.githubToken || '');
    if (token) init.headers['Authorization'] = 'Bearer ' + token;
    if (opts && opts.json) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.json);
    }
    return fetch(path, init).then(function (res) {
      return res.json().then(function (data) {
        if (res.status === 401) github.authed = false;
        var out = { ok: res.ok, status: res.status, data: data };
        setDebug('请求返回 ' + res.status + (path.indexOf('dispatches') >= 0 ? '（dispatch）' : ''));
        return out;
      }).catch(function () {
        var out = { ok: false, status: res.status, data: null };
        setDebug('请求返回 ' + res.status + '（无响应体）');
        return out;
      });
    }).catch(function (e) {
      setDebug('请求异常：' + (e && e.message ? e.message : '网络错误'));
      return { ok: false, status: 0, data: null };
    });
  }
  function ghRepo() { return (CFG.pages && CFG.pages.repo) || ''; }
  function ghDataUrl() {
    var r = ghRepo();
    return r ? 'https://raw.githubusercontent.com/' + r + '/main/' + (CFG.pages.dataPath || 'data/products.json') : '';
  }
  function ghDispatch(eventType, payload, token) {
    return ghApi('https://api.github.com/repos/' + ghRepo() + '/dispatches', {
      method: 'POST', token: token, json: { event_type: eventType, client_payload: payload }
    });
  }
  function rid() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function ghAuthUrl() {
    var r = ghRepo();
    return r ? 'https://raw.githubusercontent.com/' + r + '/main/w/outputs/site/data/admin-auth.json' : '';
  }
  function ghAuthSiteUrl() {
    return location.origin + location.pathname + 'data/admin-auth.json';
  }
  function ghAuthSiteUrl() {
    return location.origin + location.pathname + 'data/admin-auth.json';
  }
  function pollAuth(requestId, timeoutMs) {
    var rawUrl = ghAuthUrl();
    var siteUrl = ghAuthSiteUrl();
    var started = Date.now();
    var lastId = '';
    function fetchOne(url) {
      return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('poll ' + res.status);
        return res.text();
      });
    }
    function tick(resolve, reject) {
      fetchOne(siteUrl).catch(function () { return ''; }).then(function (body) {
        var obj = null;
        try { obj = JSON.parse(body); } catch (e) {}
        if (obj && obj.request_id && obj.request_id !== lastId) {
          lastId = obj.request_id;
          setDebug('回执出现 ' + obj.request_id + '（等待 ' + requestId + '）');
          if (obj.request_id === requestId) {
            resolve(obj);
            return;
          }
        }
        return fetchOne(rawUrl).catch(function () { return ''; }).then(function (body2) {
          var obj2 = null;
          try { obj2 = JSON.parse(body2); } catch (e) {}
          if (obj2 && obj2.request_id && obj2.request_id !== lastId) {
            lastId = obj2.request_id;
            setDebug('raw回执 ' + obj2.request_id + '（等待 ' + requestId + '）');
            if (obj2.request_id === requestId) {
              resolve(obj2);
              return;
            }
          }
          if (Date.now() - started > timeoutMs) {
            reject(new Error('timeout'));
            return;
          }
          setTimeout(function () { tick(resolve, reject); }, 2000);
        });
      });
    }
    return new Promise(function (resolve, reject) { tick(resolve, reject); });
  }
  function ghWritePending(products) {
    var r = ghRepo();
    var path = 'w/outputs/site/data/pending-products.json';
    var content = btoa(unescape(encodeURIComponent(JSON.stringify({
      schema: SCHEMA,
      savedAt: new Date().toISOString(),
      products: products
    }))));
    return ghApi('https://api.github.com/repos/' + r + '/contents/' + path, {
      method: 'PUT',
      token: state.githubToken,
      json: { message: 'chore: stage products from admin', content: content, branch: 'main' }
    }).then(function (res) {
      return { ok: res.ok, status: res.status };
    });
  }
  function ghRequest(eventType, payload) {
    payload.request_id = rid();
    setDebug('发送请求 ' + eventType + '（ID: ' + payload.request_id + '）');
    return ghDispatch(eventType, payload, state.githubToken).then(function (r) {
      if (r.status === 401 || r.status === 403) {
        setDebug('请求被拒（令牌无效）');
        return { ok: false, error: 'token' };
      }
      if (!r.ok) {
        setDebug('请求发送失败（状态 ' + r.status + '）');
        return { ok: false, error: 'dispatch' };
      }
      setDebug('请求已发送，等待校验回执…');
      return pollAuth(payload.request_id, 60000).then(function (auth) {
        setDebug('收到回执：' + (auth.valid ? '口令正确' : '口令错误'));
        return { ok: !!auth.valid, auth: auth };
      }).catch(function () {
        setDebug('等待回执超时');
        return { ok: false, error: 'timeout' };
      });
    });
  }
  function setDebug(msg) {
    var el = document.getElementById('pass-debug');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }

  var state = {
    lang: storeGet(LANG_KEY) === 'es' ? 'es' : 'zh',
    products: [],
    category: 'all',
    query: '',
    unlocked: false,
    editingId: null
  };
  var server = { mode: false, authed: false, images: null };
  var github = { mode: !!CFG.pages, authed: false };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function t(key) {
    var dict = I18N[state.lang] || {};
    var v = dict;
    key.split('.').forEach(function (k) { v = v ? v[k] : undefined; });
    if (v === undefined) v = (I18N.zh || {})[key];
    return (v === undefined || v === null) ? key : v;
  }
  function catName(key) {
    var m = (I18N[state.lang] || {}).categoryNames || {};
    return m[key] || key;
  }
  function statusName(key) {
    var m = (I18N[state.lang] || {}).statusNames || {};
    return m[key] || key;
  }
  function toNum(v) {
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    var n = parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10);
    return isNaN(n) ? 0 : n;
  }
  function fmtPrice(n) {
    var x = toNum(n);
    return (CFG.currencySymbol || '$') + ' ' + Number(x).toLocaleString('en-US');
  }
  function imgSrc(name) {
    if (!name) return '';
    if (/^data:/i.test(name)) return name;
    return 'images/products/' + encodeURI(name);
  }
  function normalize(p, id) {
    var o = {
      code: p.code != null ? String(p.code) : '',
      name: p.name || '',
      category: p.category || '文胸',
      sizes: p.sizes != null ? String(p.sizes) : '',
      unitPrice: toNum(p.unitPrice),
      dozenPrice: toNum(p.dozenPrice),
      image: p.image || '',
      status: p.status || '',
      note: p.note || ''
    };
    if (p.id !== undefined && p.id !== null) o.id = p.id;
    else if (id !== undefined && id !== null) o.id = id;
    return o;
  }

  function loadProducts() {
    try {
      var raw = storeGet(STORAGE_KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && (obj.schema === 1 || obj.schema === SCHEMA) && Array.isArray(obj.products)) {
          var migrated = false;
          var list = obj.products.map(function (p, i) {
            var n = normalize(p, i + 1);
            if (n.category === '内裤-丁字裤') {
              n.category = '内裤';
              migrated = true;
            }
            return n;
          });
          if (migrated || obj.schema !== SCHEMA) saveProducts(list);
          return list;
        }
      }
    } catch (e) {}
    return SEED.map(function (p, i) { return normalize(p, i + 1); });
  }
  function saveProducts(list) {
    if (!github.mode) {
      var payload = { schema: SCHEMA, savedAt: new Date().toISOString(), products: list };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (e) {
        alert(t('uploadTooBig'));
      }
      return Promise.resolve(true);
    }
    return ghWritePending(list).then(function (w) {
      if (!w.ok) {
        alert(t('saveErr'));
        return false;
      }
      return ghRequest('update-products', {
        password: state.adminPassword,
        schema: SCHEMA
      }).then(function (r) {
        if (r.ok) {
          alert(t('saved'));
          return true;
        }
        alert(t('saveErr'));
        return false;
      });
    });
  }
  function nextId() {
    return state.products.reduce(function (m, p) { return Math.max(m, toNum(p.id)); }, 0) + 1;
  }
  function indexById(id) {
    for (var i = 0; i < state.products.length; i++) {
      if (String(state.products[i].id) === String(id)) return i;
    }
    return -1;
  }
  function filtered() {
    var q = state.query.trim().toLowerCase();
    return state.products.filter(function (p) {
      if (state.category !== 'all' && p.category !== state.category) return false;
      if (!q) return true;
      return String(p.code).toLowerCase().indexOf(q) >= 0 ||
        String(p.name).toLowerCase().indexOf(q) >= 0;
    });
  }
  function filteredAdmin() {
    var q = ($('admin-search').value || '').trim().toLowerCase();
    var c = $('admin-cat').value || 'all';
    return state.products.filter(function (p) {
      if (c !== 'all' && p.category !== c) return false;
      if (!q) return true;
      return String(p.code).toLowerCase().indexOf(q) >= 0 ||
        String(p.name).toLowerCase().indexOf(q) >= 0;
    });
  }

  /* ---------- 渲染 ---------- */
  function applyI18n() {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
  }
  function renderHeader() {
    document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'es';
    $('subtitle').textContent = state.lang === 'zh' ? (CFG.subtitleZh || '') : (CFG.subtitleEs || '');
    $('store-line').textContent = CFG.storeLine || '';
    $('lang-zh').textContent = I18N.zh.langName;
    $('lang-es').textContent = I18N.es.langName;
    $('lang-zh').classList.toggle('active', state.lang === 'zh');
    $('lang-es').classList.toggle('active', state.lang === 'es');
    $('search').placeholder = t('searchPlaceholder');
    $('footer-contact').textContent = state.lang === 'zh' ? (CFG.contactZh || '') : (CFG.contactEs || '');
    $('btn-admin').textContent = t('admin');
    var vEl = $('site-version');
    if (vEl) vEl.textContent = 'v' + APP_VERSION;
  }
  function renderNav() {
    var nav = $('cats');
    nav.textContent = '';
    function makeBtn(key, label, count) {
      var b = el('button', 'cat-btn' + (state.category === key ? ' active' : ''), label);
      b.type = 'button';
      b.dataset.cat = key;
      b.appendChild(el('span', 'cat-count', String(count)));
      return b;
    }
    nav.appendChild(makeBtn('all', t('all'), state.products.length));
    I18N.categoryKeys.forEach(function (key) {
      var n = state.products.filter(function (p) { return p.category === key; }).length;
      nav.appendChild(makeBtn(key, catName(key), n));
    });
  }
  function card(p) {
    var c = el('article', 'card');
    c.dataset.id = p.id;
    var media = el('div', 'card-media');
    var ph = el('div', 'card-ph', p.code || 'HEAT');
    ph.hidden = true;
    var img = document.createElement('img');
    img.alt = p.code || 'HEAT';
    if (p.image) {
      img.src = imgSrc(p.image);
      img.loading = QA ? 'eager' : 'lazy';
    } else {
      ph.hidden = false;
    }
    img.addEventListener('error', function () { img.style.display = 'none'; ph.hidden = false; });
    media.appendChild(img);
    media.appendChild(ph);
    var body = el('div', 'card-body');
    body.appendChild(el('div', 'card-code', p.code || '—'));
    if (p.name) body.appendChild(el('div', 'card-name', p.name));
    body.appendChild(el('div', 'card-sizes', p.sizes || ''));
    var pr1 = el('div', 'card-price');
    pr1.appendChild(el('span', 'label', t('unitPrice')));
    pr1.appendChild(el('span', 'value', fmtPrice(p.unitPrice)));
    var pr2 = el('div', 'card-price dozen');
    pr2.appendChild(el('span', 'label', t('dozenPrice')));
    pr2.appendChild(el('span', 'value', fmtPrice(p.dozenPrice)));
    body.appendChild(pr1);
    body.appendChild(pr2);
    c.appendChild(media);
    c.appendChild(body);
    c.addEventListener('click', function () { openLightbox(p); });
    return c;
  }
  function renderGrid() {
    var grid = $('grid');
    grid.textContent = '';
    var list = filtered();
    list.forEach(function (p) { grid.appendChild(card(p)); });
    $('empty').hidden = list.length > 0;
    $('empty').textContent = t('noResults');
    $('count').textContent = list.length + ' ' + t('countSuffix');
    document.documentElement.setAttribute('data-self-test',
      'v:' + APP_VERSION + ':seed:' + SEED.length + ':cards:' + list.length + ':lang:' + state.lang + ':mode:' + (github.mode ? 'pages' : 'local'));
  }
  function renderAll() {
    applyI18n();
    renderHeader();
    renderNav();
    renderGrid();
    if (state.adminOpen && !$('admin-overlay').hidden) renderAdminLabels();
  }

  /* ---------- 灯箱 ---------- */
  function openLightbox(p) {
    var img = $('lb-img');
    if (p.image) {
      img.src = imgSrc(p.image);
      img.style.display = '';
    } else {
      img.style.display = 'none';
    }
    $('lb-code').textContent = t('code') + ': ' + (p.code || '—');
    $('lb-name').textContent = p.name || '';
    $('lb-cat').textContent = t('category') + ': ' + catName(p.category);
    $('lb-size').textContent = t('size') + ': ' + (p.sizes || '—');
    $('lb-unit').innerHTML = '';
    $('lb-unit').appendChild(el('span', '', t('unitPrice') + ':'));
    $('lb-unit').appendChild(el('span', 'v', fmtPrice(p.unitPrice)));
    $('lb-dozen').innerHTML = '';
    $('lb-dozen').appendChild(el('span', '', t('dozenPrice') + ':'));
    $('lb-dozen').appendChild(el('span', 'v', fmtPrice(p.dozenPrice)));
    $('lightbox').hidden = false;
  }
  function closeLightbox() {
    $('lightbox').hidden = true;
    $('lb-img').removeAttribute('src');
  }

  /* ---------- 管理面板 ---------- */
  function openAdmin() {
    if (github.mode && !github.authed) state.unlocked = false;
    if (!state.unlocked) {
      $('pass-msg').textContent = '';
      $('pass-msg').style.color = '';
      var dbg = $('pass-debug');
      if (dbg) { dbg.textContent = ''; dbg.style.display = 'none'; }
      var pv = $('pass-version');
      if (pv) pv.textContent = 'v' + APP_VERSION;
      $('pass-input').value = '';
      $('pass-token').value = state.githubToken || '';
      $('pass-token').hidden = !github.mode;
      $('pass-token-label').hidden = !github.mode;
      $('pass-token-label').textContent = t('tokenLabel');
      $('pass-token').placeholder = t('tokenPlaceholder');
      $('pass-overlay').hidden = false;
      $('pass-input').focus();
      return;
    }
    $('admin-overlay').hidden = false;
    state.adminOpen = true;
    renderAdminLabels();
    renderAdminTable();
  }
  function closeAdmin() {
    $('admin-overlay').hidden = true;
    state.adminOpen = false;
  }
  function tryUnlock() {
    var pw = $('pass-input').value;
    var tk = $('pass-token').value.trim();
    if (!github.mode) {
      if (pw === String(CFG.adminPasscode || '8888')) {
        state.unlocked = true;
        $('pass-overlay').hidden = true;
        openAdmin();
      } else {
        $('pass-msg').textContent = t('passcodeWrong');
        $('pass-input').value = '';
        $('pass-input').focus();
      }
      return;
    }
    state.adminPassword = pw;
    state.githubToken = (tk || (CFG.pages && CFG.pages.token) || '').trim();
    if (!state.githubToken) {
      $('pass-msg').textContent = t('tokenRequired');
      $('pass-msg').style.color = '#b23b3b';
      $('pass-token').focus();
      return;
    }
    $('pass-msg').textContent = t('checkingPass');
    $('pass-msg').style.color = '#8a8a8a';
    ghRequest('check-password', { password: pw }).then(function (r) {
      if (r.ok) {
        state.unlocked = true;
        github.authed = true;
        $('pass-msg').textContent = '';
        $('pass-overlay').hidden = true;
        openAdmin();
      } else if (r.error === 'token') {
        $('pass-msg').textContent = t('tokenError');
        $('pass-msg').style.color = '#b23b3b';
        $('pass-token').focus();
      } else if (r.error === 'timeout') {
        $('pass-msg').textContent = t('passTimeout');
        $('pass-msg').style.color = '#b23b3b';
      } else {
        $('pass-msg').textContent = t('passcodeWrong');
        $('pass-msg').style.color = '#b23b3b';
        $('pass-input').value = '';
        $('pass-input').focus();
      }
    });
  }
  function buildSelect(sel, keys, labelFn, selected) {
    var cur = selected !== undefined ? selected : sel.value;
    sel.textContent = '';
    keys.forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = labelFn(k);
      sel.appendChild(o);
    });
    if (cur && keys.indexOf(cur) >= 0) sel.value = cur;
  }
  function renderAdminLabels() {
    applyI18n();
    $('admin-title').textContent = t('adminTitle');
    $('btn-add').textContent = t('addProduct');
    $('btn-export').textContent = t('export');
    $('btn-import').textContent = t('import');
    $('btn-reset').textContent = t('reset');
    $('btn-logout').textContent = t('logout');
    $('admin-search').placeholder = t('searchPlaceholder');
    $('pass-title').textContent = t('passcodeTitle');
    $('pass-prompt').textContent = t('passcodePrompt');
    $('btn-unlock').textContent = t('unlock');
    $('btn-save').textContent = t('save');
    $('btn-cancel').textContent = t('cancel');
    $('btn-upload').textContent = t('imageUpload');
    $('f-image').placeholder = t('imageFileName');
    $('f-image-tip').textContent = t('imageTip');
    var curCat = $('admin-cat').value || 'all';
    buildSelect($('admin-cat'), ['all'].concat(I18N.categoryKeys), function (k) {
      return k === 'all' ? t('all') : catName(k);
    }, curCat);
  }
  function adminRow(p) {
    var tr = el('tr');
    var tdThumb = el('td');
    if (p.image) {
      var im = document.createElement('img');
      im.className = 'thumb';
      im.src = imgSrc(p.image);
      im.alt = '';
      im.addEventListener('error', function () { im.style.visibility = 'hidden'; });
      tdThumb.appendChild(im);
    } else {
      tdThumb.textContent = '—';
    }
    tr.appendChild(tdThumb);
    tr.appendChild(el('td', '', String(p.id)));
    tr.appendChild(el('td', '', p.code || '—'));
    tr.appendChild(el('td', '', catName(p.category)));
    tr.appendChild(el('td', '', p.sizes || '—'));
    tr.appendChild(el('td', '', fmtPrice(p.unitPrice)));
    tr.appendChild(el('td', '', fmtPrice(p.dozenPrice)));
    tr.appendChild(el('td', '', statusName(p.status || '')));
    var tdNote = el('td', 'note-cell', p.note || '');
    tdNote.title = p.note || '';
    tr.appendChild(tdNote);
    var tdAct = el('td');
    var bEdit = el('button', 'btn btn-sm', t('edit'));
    bEdit.type = 'button';
    bEdit.addEventListener('click', function () { openForm(p.id); });
    var bDel = el('button', 'btn btn-sm danger', t('delete'));
    bDel.type = 'button';
    bDel.addEventListener('click', function () {
      if (confirm(t('deleteConfirm'))) {
        var i = indexById(p.id);
        if (i < 0) return;
        var removed = state.products.splice(i, 1)[0];
        saveProducts(state.products).then(function (ok) {
          if (!ok) {
            state.products.splice(i, 0, removed);
            return;
          }
          renderAdminTable();
          renderGrid();
          renderNav();
        });
      }
    });
    tdAct.appendChild(bEdit);
    tdAct.appendChild(bDel);
    tr.appendChild(tdAct);
    return tr;
  }
  function renderAdminTable() {
    var tbody = $('admin-tbody');
    tbody.textContent = '';
    filteredAdmin().forEach(function (p) { tbody.appendChild(adminRow(p)); });
  }

  /* ---------- 商品表单 ---------- */
  function renderImageSelect(list, selected) {
    var sel = $('f-image-select');
    sel.textContent = '';
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = '— ' + t('imagePick') + ' —';
    sel.appendChild(ph);
    list.forEach(function (f) {
      var o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      sel.appendChild(o);
    });
    if (selected && list.indexOf(selected) >= 0) sel.value = selected;
    else sel.value = '';
  }
  function updatePreview() {
    var v = $('f-image').value.trim();
    var img = $('f-preview');
    if (!v) { img.hidden = true; img.removeAttribute('src'); return; }
    img.hidden = false;
    img.src = imgSrc(v);
    img.onerror = function () { img.hidden = true; };
    img.onload = function () { img.hidden = false; };
  }
  function openForm(id) {
    state.editingId = id;
    var p = id !== null ? state.products[indexById(id)] : null;
    $('form-title').textContent = p ? t('editProduct') : t('addProduct');
    $('f-code').value = p ? (p.code || '') : '';
    $('f-name').value = p ? (p.name || '') : '';
    buildSelect($('f-category'), I18N.categoryKeys, catName, p ? p.category : '文胸');
    $('f-sizes').value = p ? (p.sizes || '') : '';
    $('f-unit').value = p ? String(p.unitPrice || '') : '';
    $('f-dozen').value = p ? String(p.dozenPrice || '') : '';
    buildSelect($('f-status'), I18N.statusKeys, statusName, p ? (p.status || '已匹配') : '已匹配');
    $('f-note').value = p ? (p.note || '') : '';
    $('f-image').value = p ? (p.image || '') : '';
    renderImageSelect(IMAGES, p ? p.image : '');
    updatePreview();
    $('form-overlay').hidden = false;
  }
  function closeForm() {
    $('form-overlay').hidden = true;
    state.editingId = null;
  }
  function saveForm() {
    var code = $('f-code').value.trim();
    var cat = $('f-category').value;
    var sizes = $('f-sizes').value.trim();
    if (!code || !cat || !sizes) { alert(t('required')); return; }
    var obj = normalize({
      code: code,
      name: $('f-name').value.trim(),
      category: cat,
      sizes: sizes,
      unitPrice: toNum($('f-unit').value),
      dozenPrice: toNum($('f-dozen').value),
      image: $('f-image').value.trim(),
      status: $('f-status').value,
      note: $('f-note').value.trim()
    });
    if (state.editingId === null) {
      obj.id = nextId();
      state.products.push(obj);
    } else {
      var i = indexById(state.editingId);
      if (i >= 0) {
        obj.id = state.products[i].id;
        state.products[i] = obj;
      }
    }
    saveProducts(state.products).then(function (ok) {
      if (!ok) return;
      closeForm();
      renderGrid();
      renderNav();
      renderAdminTable();
    });
  }

  /* ---------- 导出 / 导入 / 重置 ---------- */
  function exportData() {
    var payload = { schema: SCHEMA, exportedAt: new Date().toISOString(), products: state.products };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'heat_products_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function importData(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var obj = JSON.parse(fr.result);
        var list = Array.isArray(obj) ? obj : (obj && Array.isArray(obj.products) ? obj.products : null);
        if (!list) throw new Error('bad format');
        state.products = list.map(function (p, i) { return normalize(p, i + 1); });
        saveProducts(state.products).then(function (ok) {
          if (!ok) return;
          renderGrid();
          renderNav();
          renderAdminTable();
          alert(t('importOk').replace('{n}', state.products.length));
        });
      } catch (e) {
        alert(t('importErr'));
      }
    };
    fr.readAsText(file);
  }
  function resetData() {
    if (!confirm(t('resetConfirm'))) return;
    if (github.mode) {
      var seed = SEED.map(function (p, i) { return normalize(p, i + 1); });
      ghWritePending(seed).then(function (w) {
        if (!w.ok) { alert(t('saveErr')); return; }
        return ghRequest('update-products', {
          password: state.adminPassword,
          schema: SCHEMA
        }).then(function (r) {
          if (r.ok) {
            state.products = seed;
            renderGrid();
            renderNav();
            renderAdminTable();
            alert(t('saved'));
          } else {
            alert(t('saveErr'));
          }
        });
      });
      return;
    }
    storeDel(STORAGE_KEY);
    state.products = SEED.map(function (p, i) { return normalize(p, i + 1); });
    renderGrid();
    renderNav();
    renderAdminTable();
  }

  /* ---------- 初始化 ---------- */
  function setLang(l) {
    if (state.lang === l) return;
    state.lang = l;
    storeSet(LANG_KEY, l);
    renderAll();
  }
  function init() {
    state.products = loadProducts();

    $('lang-zh').addEventListener('click', function () { setLang('zh'); });
    $('lang-es').addEventListener('click', function () { setLang('es'); });
    $('search').addEventListener('input', function () {
      state.query = this.value;
      renderNav();
      renderGrid();
    });
    $('cats').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.cat-btn') : null;
      if (!btn) return;
      state.category = btn.dataset.cat;
      renderNav();
      renderGrid();
    });

    $('lb-close').addEventListener('click', closeLightbox);
    $('lightbox').addEventListener('click', function (e) { if (e.target === this) closeLightbox(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('lightbox').hidden) closeLightbox();
        else if (!$('form-overlay').hidden) closeForm();
        else if (!$('admin-overlay').hidden) closeAdmin();
        else if (!$('pass-overlay').hidden) { $('pass-overlay').hidden = true; }
      }
    });

    $('btn-admin').addEventListener('click', openAdmin);
    $('admin-close').addEventListener('click', closeAdmin);
    $('btn-unlock').addEventListener('click', tryUnlock);
    $('pass-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlock(); });
    $('admin-search').addEventListener('input', renderAdminTable);
    $('admin-cat').addEventListener('change', renderAdminTable);
    $('btn-add').addEventListener('click', function () { openForm(null); });
    $('btn-export').addEventListener('click', exportData);
    $('btn-import').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function () {
      if (this.files && this.files[0]) importData(this.files[0]);
      this.value = '';
    });
    $('btn-reset').addEventListener('click', resetData);
    $('btn-cancel').addEventListener('click', closeForm);
    $('btn-save').addEventListener('click', saveForm);
    $('f-image-select').addEventListener('change', function () {
      $('f-image').value = this.value;
      updatePreview();
    });
    $('f-image').addEventListener('input', updatePreview);
    $('btn-upload').addEventListener('click', function () { $('upload-file').click(); });
    $('upload-file').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      if (f.size > MAX_UPLOAD) { alert(t('uploadTooBig')); this.value = ''; return; }
      var frLocal = new FileReader();
      frLocal.onload = function () {
        $('f-image').value = frLocal.result;
        updatePreview();
      };
      frLocal.onerror = function () { alert(t('uploadErr')); };
      frLocal.readAsDataURL(f);
      this.value = '';
    });

    $('btn-logout').addEventListener('click', function () {
      github.authed = false;
      state.unlocked = false;
      state.adminPassword = '';
      closeAdmin();
    });
    $('btn-logout').hidden = !github.mode;

    function finish() {
      renderAll();
      window.__HEAT = {
        state: state,
        server: server,
        github: github,
        t: t,
        fmtPrice: fmtPrice,
        saveProducts: saveProducts,
        resetData: resetData,
        exportData: exportData,
        renderAll: renderAll
      };
    }

    function boot() {
      state.products = loadProducts();
      finish();
    }
    if (github.mode && ghDataUrl()) {
      fetch(ghDataUrl(), { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('fetch failed');
        return res.json();
      }).then(function (obj) {
        var list = Array.isArray(obj) ? obj : (obj && Array.isArray(obj.products) ? obj.products : null);
        if (list && list.length) {
          state.products = list.map(function (p, i) { return normalize(p, i + 1); });
        }
        finish();
      }).catch(function () { boot(); });
    } else {
      boot();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
