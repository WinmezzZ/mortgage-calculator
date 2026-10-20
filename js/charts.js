/**
 * 图表模块（零依赖，手写 SVG）
 * 暴露 window.Charts：donut（本金/利息占比环形图）、line（还款曲线图）。
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, text) {
    var node = document.createElementNS(NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function fmtWan(v) {
    var wan = v / 10000;
    return wan >= 100 ? Math.round(wan) + ' 万' : wan.toFixed(1) + ' 万';
  }

  /**
   * 环形图
   * @param {HTMLElement} container
   * @param {object} opts {principal, interest}（单位：元）
   */
  function donut(container, opts) {
    var principal = opts.principal || 0;
    var interest = opts.interest || 0;
    var total = principal + interest;

    container.innerHTML = '';
    if (total <= 0) return;

    var size = 190;
    var r = 74;
    var stroke = 26;
    var c = 2 * Math.PI * r;
    var fracP = principal / total;
    var ratioPct = (interest / total) * 100;

    var svg = el('svg', {
      viewBox: '0 0 ' + size + ' ' + size,
      role: 'img',
      'aria-label': '本金与利息占比环形图'
    });

    // 轨道
    svg.appendChild(el('circle', {
      cx: size / 2, cy: size / 2, r: r,
      fill: 'none', stroke: '#eef1f5', 'stroke-width': stroke
    }));

    // 利息段（琥珀色）
    if (interest > 0) {
      svg.appendChild(el('circle', {
        cx: size / 2, cy: size / 2, r: r,
        fill: 'none', stroke: '#f59e0b', 'stroke-width': stroke,
        'stroke-dasharray': (fracP * c) + ' ' + c,
        transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')',
        'stroke-linecap': 'butt'
      }));
    }

    // 本金段（主色）——盖在利息段之上，从 0 开始
    svg.appendChild(el('circle', {
      cx: size / 2, cy: size / 2, r: r,
      fill: 'none', stroke: '#ff6a3d', 'stroke-width': stroke,
      'stroke-dasharray': (fracP * c) + ' ' + c,
      transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')',
      'stroke-linecap': 'round'
    }));

    // 中心文字
    var ratioText = ratioPct < 10 ? ratioPct.toFixed(1) + '%' : Math.round(ratioPct) + '%';
    svg.appendChild(el('text', {
      x: size / 2, y: size / 2 - 4,
      'text-anchor': 'middle', 'font-size': '26', 'font-weight': '700',
      fill: '#1f2937'
    }, ratioText));
    svg.appendChild(el('text', {
      x: size / 2, y: size / 2 + 16,
      'text-anchor': 'middle', 'font-size': '11.5', fill: '#6b7280'
    }, '利息占比'));

    container.appendChild(svg);

    // 图例
    var legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML =
      '<span class="legend-item"><span class="legend-dot" style="background:#ff6a3d"></span>本金 ' +
      fmtWan(principal) + ' 元</span>' +
      '<span class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span>利息 ' +
      fmtWan(interest) + ' 元</span>';
    container.appendChild(legend);
  }

  /**
   * 折线 / 面积图
   * @param {HTMLElement} container
   * @param {object} opts {
   *   labels: [string],           // 与 points 等长
   *   series: [{name, points:[number], color, fill?:boolean}],
   *   valueFormat?: function(v)
   * }
   */
  function line(container, opts) {
    var labels = opts.labels || [];
    var series = opts.series || [];
    var fmt = opts.valueFormat || fmtWan;

    container.innerHTML = '';
    if (!series.length || !labels.length) return;

    var W = 560, H = 250;
    var pad = { l: 56, r: 18, t: 16, b: 36 };
    var iw = W - pad.l - pad.r;
    var ih = H - pad.t - pad.b;

    // 数据范围
    var min = 0;
    var max = 0;
    series.forEach(function (s) {
      s.points.forEach(function (p) {
        if (p > max) max = p;
        if (p < min) min = p;
      });
    });
    if (max <= 0) max = 1;

    // 优刻度
    function niceStep(range, ticks) {
      var raw = range / ticks;
      var mag = Math.pow(10, Math.floor(Math.log10(raw)));
      var norm = raw / mag;
      var f = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
      return f * mag;
    }
    var step = niceStep(max - min, 4);
    var yMax = Math.ceil(max / step) * step;
    var yMin = Math.floor(min / step) * step;

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '还款曲线图' });
    var defs = el('defs');
    svg.appendChild(defs);

    function xAt(i) {
      return labels.length === 1
        ? pad.l + iw / 2
        : pad.l + (iw * i) / (labels.length - 1);
    }
    function yAt(v) {
      return pad.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
    }

    // 横向网格 + Y 轴刻度
    var tickV = yMin;
    while (tickV <= yMax + step * 0.001) {
      var y = yAt(tickV);
      svg.appendChild(el('line', {
        x1: pad.l, y1: y, x2: W - pad.r, y2: y,
        stroke: '#eef1f5', 'stroke-width': 1
      }));
      svg.appendChild(el('text', {
        x: pad.l - 8, y: y + 4,
        'text-anchor': 'end', 'font-size': '10.5', fill: '#9ca3af'
      }, fmt(tickV)));
      tickV += step;
    }

    // X 轴刻度
    labels.forEach(function (label, i) {
      if (i > 0 && i < labels.length - 1 && i % 2 === 1) return; // 稀疏标注
      svg.appendChild(el('text', {
        x: xAt(i), y: H - pad.b + 18,
        'text-anchor': 'middle', 'font-size': '10.5', fill: '#9ca3af'
      }, label));
    });
    svg.appendChild(el('text', {
      x: W / 2, y: H - 4,
      'text-anchor': 'middle', 'font-size': '10.5', fill: '#9ca3af'
    }, '期数（月）'));

    // 面积（剩余本金）
    series.forEach(function (s) {
      if (!s.fill) return;
      var pts = s.points.map(function (v, i) {
        return xAt(i).toFixed(1) + ',' + yAt(v).toFixed(1);
      }).join(' ');
      var area = el('polygon', {
        points: pad.l + ',' + yAt(yMin) + ' ' + pts + ' ' + xAt(s.points.length - 1) + ',' + yAt(yMin),
        fill: s.color, 'fill-opacity': '0.08'
      });
      svg.appendChild(area);
    });

    // 折线
    series.forEach(function (s) {
      var pts = s.points.map(function (v, i) {
        return xAt(i).toFixed(1) + ',' + yAt(v).toFixed(1);
      }).join(' ');
      svg.appendChild(el('polyline', {
        points: pts,
        fill: 'none', stroke: s.color, 'stroke-width': '2.2',
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }));
    });

    container.appendChild(svg);

    // 图例
    var legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = series.map(function (s) {
      return '<span class="legend-item"><span class="legend-dot" style="background:' + s.color + '"></span>' + s.name + '</span>';
    }).join('');
    container.appendChild(legend);
  }

  root.Charts = { donut: donut, line: line, fmtWan: fmtWan };
})(typeof self !== 'undefined' ? self : this);