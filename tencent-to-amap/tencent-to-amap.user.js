// ==UserScript==
// @name         腾讯地图 → 高德地图
// @namespace    https://github.com/id-verne/_chrome-extensions
// @version      1.2.0
// @description  在腾讯地图网页版右下角注入一个按钮，优先识别并跳转当前选中的地物/POI，未选中时跳转视口中心到高德地图。坐标同属 GCJ-02，直接透传，无需转换。
// @author       ID-VerNe
// @match        *://map.qq.com/*
// @match        *://maps.qq.com/*
// @match        *://ditu.qq.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // 腾讯地图每次平移/缩放都会向 router.map.qq.com/roam 发送 JSONP 请求，
  // 其中 b= 参数为视口 bounding box，中点即地图中心。
  // 在地图实例尚未完全初始化的启动阶段，hook <script>.src 是捕获初始中心最稳妥的途径。
  const RE_ROAM = /router\.map\.qq\.com\/roam\?[^#]*\bb=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/;

  let roamCenter = null; // {lat, lng, zoom}

  function onRoam(url) {
    const m = RE_ROAM.exec(url);
    if (!m) return;

    const xs = [parseFloat(m[1]), parseFloat(m[3])];
    const ys = [parseFloat(m[2]), parseFloat(m[4])];
    const lng = (Math.min(...xs) + Math.max(...xs)) / 2;
    const lat = (Math.min(...ys) + Math.max(...ys)) / 2;

    if (!isFinite(lat) || !isFinite(lng)) return;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

    const zoom = /[?&]l=(\d+)/.exec(url);
    roamCenter = { lat, lng, zoom: zoom ? Number(zoom[1]) : undefined };
  }

  // 主 hook：页面自身通过 <script>.src 发送 roam 请求
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  Object.defineProperty(HTMLScriptElement.prototype, 'src', {
    get: srcDesc.get,
    set(value) {
      try {
        if (typeof value === 'string' && value.indexOf('roam?') >= 0) onRoam(value);
      } catch (e) {
        /* hook 异常绝不影响腾讯地图宿主功能 */
      }
      return srcDesc.set.call(this, value);
    },
    configurable: true,
  });

  // 备用 hook：预防站点将 roam 迁移至 XHR 或 fetch
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (typeof url === 'string' && url.indexOf('roam?') >= 0) onRoam(url);
    } catch (e) {}
    return open.apply(this, arguments);
  };

  const fetch_ = window.fetch;
  window.fetch = function (input) {
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      if (typeof url === 'string' && url.indexOf('roam?') >= 0) onRoam(url);
    } catch (e) {}
    return fetch_.apply(this, arguments);
  };

  // ---------------------------------------------------------------- 状态探测

  /**
   * 探测用户当前在腾讯地图中选中的地物（POI）。
   * 无论是左侧列表点击还是底图标记点击，都会触发并展示信息气泡 (.iwContainer)。
   */
  function getSelectedPoi() {
    try {
      const iw = document.querySelector('.iwContainer');
      if (!iw || iw.offsetWidth <= 0 || iw.offsetHeight <= 0) return null;

      // 提取名称与地址
      const name =
        iw.querySelector('input[name="to"]')?.value ||
        iw.querySelector('input[name="from"]')?.value ||
        iw.querySelector('.titleText')?.textContent?.trim() ||
        '';

      const address = iw.querySelector('.iwRichContainer')?.textContent?.trim() || '';

      // 1. 优先从表单隐藏字段读取精确坐标（格式为 "lng,lat"）
      const coordStr =
        iw.querySelector('input[name="tocoord"]')?.value ||
        iw.querySelector('input[name="fromcoord"]')?.value;

      if (coordStr && coordStr.indexOf(',') > 0) {
        const parts = coordStr.split(',');
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          return { name, lat, lng, address };
        }
      }

      // 2. 备用：从 DOM 绝对定位锚点容器换算像素坐标到经纬度
      if (window.QMM && window.QMM.map && window.qq && window.qq.maps) {
        let cur = iw;
        let anchor = null;
        while (cur && cur !== document.body) {
          if (cur.style && cur.style.zIndex === '0' && cur.style.left && cur.style.top) {
            anchor = cur;
            break;
          }
          cur = cur.parentElement;
        }

        if (anchor) {
          const left = parseFloat(anchor.style.left);
          const top = parseFloat(anchor.style.top);
          if (isFinite(left) && isFinite(top)) {
            const pt = new window.qq.maps.Point(left, top);
            const ll = window.QMM.map.fromContainerPixelToLatLng(pt);
            if (ll) {
              const lat = ll.getLat();
              const lng = ll.getLng();
              if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
                return { name, lat, lng, address };
              }
            }
          }
        }
      }
    } catch (e) {}
    return null;
  }

  /**
   * 获取当前视口中心。
   * 地图初始化后优先使用原生 API window.QMM.map.getCenter()，备用 roamCenter。
   */
  function getMapCenter() {
    try {
      if (window.QMM && window.QMM.map && typeof window.QMM.map.getCenter === 'function') {
        const c = window.QMM.map.getCenter();
        if (c && typeof c.getLat === 'function') {
          const lat = c.getLat();
          const lng = c.getLng();
          if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            return {
              lat,
              lng,
              zoom: typeof window.QMM.map.getZoom === 'function' ? window.QMM.map.getZoom() : undefined,
            };
          }
        }
      }
    } catch (e) {}
    return roamCenter;
  }

  // ---------------------------------------------------------------- 按钮与交互

  const BTN_ID = 't2a-btn';

  function getState() {
    const selected = getSelectedPoi();
    if (selected) {
      const shortName = selected.name.length > 7 ? selected.name.slice(0, 6) + '…' : selected.name;
      return {
        type: 'poi',
        target: selected,
        label: shortName ? '地物: ' + shortName : '选定地物',
        title:
          '已选定: ' +
          (selected.name || '未命名地物') +
          '\n坐标: ' +
          selected.lat.toFixed(5) +
          ', ' +
          selected.lng.toFixed(5) +
          (selected.address ? '\n地址: ' + selected.address : '') +
          '\n点击在高德地图打开该地物',
        bg: '#0052d9',
      };
    }

    const center = getMapCenter();
    if (center) {
      return {
        type: 'center',
        target: center,
        label: center.lat.toFixed(5) + ', ' + center.lng.toFixed(5),
        title:
          '当前中心: ' +
          center.lat.toFixed(5) +
          ', ' +
          center.lng.toFixed(5) +
          '\n点击在高德地图打开当前位置',
        bg: '#1677ff',
      };
    }

    return {
      type: 'pending',
      target: null,
      label: '定位中…',
      title: '正在等待地图定位数据…',
      bg: '#1677ff',
    };
  }

  function openAmap() {
    const state = getState();
    if (!state.target) {
      alert('还没拿到当前地图位置，切换一下地图（平移或缩放）再试。');
      return;
    }

    // 跳转高德地图新版 SSR 逆地理编码页面（ditu.amap.com/ssr/regeo）。
    // 若选中了具体地物，携带地物名称与地址；若未选中，携带页面标题。
    // coordinate=gaode 表示输入为 GCJ-02，直接透传无需偏移转换。
    const name = state.type === 'poi' ? state.target.name || document.title : document.title;
    const addressParam =
      state.type === 'poi' && state.target.address
        ? '&address=' + encodeURIComponent(state.target.address)
        : '';

    const url =
      'https://ditu.amap.com/ssr/regeo?lng=' +
      encodeURIComponent(state.target.lng) +
      '&lat=' +
      encodeURIComponent(state.target.lat) +
      '&name=' +
      encodeURIComponent(name) +
      addressParam +
      '&coordinate=gaode';

    window.open(url, '_blank', 'noopener');
  }

  function mount() {
    if (document.getElementById(BTN_ID)) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
      return;
    }

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';

    Object.assign(btn.style, {
      position: 'fixed',
      right: '16px',
      bottom: '80px',
      zIndex: '2147483647',
      padding: '8px 12px',
      border: 'none',
      borderRadius: '6px',
      color: '#fff',
      font: '600 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,.25)',
      transition: 'background 0.2s, opacity 0.2s',
      opacity: '0.85',
    });

    const refresh = () => {
      const state = getState();
      btn.textContent = state.label;
      btn.title = state.title;
      btn.style.background = state.bg;
      btn.style.opacity = state.target ? '0.85' : '0.55';
    };

    btn.addEventListener('click', openAmap);
    btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
    btn.addEventListener('mouseleave', () => {
      const state = getState();
      btn.style.opacity = state.target ? '0.85' : '0.55';
    });

    document.body.appendChild(btn);
    refresh();

    // 状态或选区变化时自动刷新按钮显示
    setInterval(refresh, 400);
  }

  mount();
})();