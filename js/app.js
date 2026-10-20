/**
 * 房贷计算器 —— 页面交互与渲染
 * 依赖：calculator.js（window.MortgageCalc）、charts.js（window.Charts）
 */
(function () {
  'use strict';

  /* ==================== 常量 ==================== */
  var LS_STATE = 'mortgage-calculator.state.v2';
  var LS_HISTORY = 'mortgage-calculator.history.v1';
  var HISTORY_MAX = 50;

  var LOAN_TYPE_LABEL = { commercial: '商业贷款', fund: '公积金贷款', combined: '组合贷款' };
  var METHOD_LABEL = { annuity: '等额本息', equalPrincipal: '等额本金' };

  /* ==================== 状态 ==================== */
  var S = {
    loanType: 'commercial',          // commercial | fund | combined
    method: 'annuity',               // annuity | equalPrincipal
    years: 30,
    commercial: { amount: 100, rate: 3.5 },
    fund: { amount: 100, rate: 2.6 },
    // 提前还款（可选）：month=第几期，amount=金额（万元），strategy=处理方式
    prepay: { month: null, amount: null, strategy: 'reducePayment' }
  };

  var lastResult = null;

  /* ==================== DOM 引用 ==================== */
  var $ = function (id) { return document.getElementById(id); };
  var dom = {
    tabs: document.querySelectorAll('.tab[data-loan-type]'),
    methodRadios: document.querySelectorAll('input[name="method"]'),
    singleAmountField: $('singleAmountField'),
    singleAmountTitle: $('singleAmountTitle'),
    amount: $('amount'),
    amountRange: $('amountRange'),
    amountError: $('amountError'),
    combinedFields: $('combinedFields'),
    comAmount: $('comAmount'),
    comRate: $('comRate'),
    comRateError: $('comRateError'),
    comAmountError: $('comAmountError'),
    fundAmount: $('fundAmount'),
    fundRate: $('fundRate'),
    fundRateError: $('fundRateError'),
    fundAmountError: $('fundAmountError'),
    years: $('years'),
    yearsRange: $('yearsRange'),
    yearsQuick: document.querySelectorAll('#yearsQuick button'),
    yearsError: $('yearsError'),
    singleRateField: $('singleRateField'),
    singleRateTitle: $('singleRateTitle'),
    rate: $('rate'),
    rateError: $('rateError'),
    prepayMonth: $('prepayMonth'),
    prepayAmount: $('prepayAmount'),
    prepayStrategies: document.querySelectorAll('input[name="prepayStrategy"]'),
    prepayError: $('prepayError'),
    prepayBar: $('prepayBar'),
    calcBtn: $('calcBtn'),
    saveBtn: $('saveBtn'),
    resultStatus: $('resultStatus'),
    monthlyValue: $('monthlyValue'),
    monthlySplit: $('monthlySplit'),
    monthlyLabel: document.querySelector('.summary-main .summary-label'),
    totalValue: $('totalValue'),
    interestValue: $('interestValue'),
    ratioValue: $('ratioValue'),
    extraBar: $('extraBar'),
    donutChart: $('donutChart'),
    lineChart: $('lineChart'),
    yearFilter: $('yearFilter'),
    tableSectionSummary: $('tableSectionSummary'),
    scheduleBody: $('scheduleBody'),
    clearHistory: $('clearHistory'),
    historyList: $('historyList')
  };

  /* ==================== 工具函数 ==================== */
  function fmtMoney(n) {
    return (Math.round(n * 100) / 100).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function round2Jiao(n) { return Math.round(n * 100) / 100; }

  function parseNum(v) {
    if (typeof v === 'number') return v;
    var n = parseFloat(v);
    return isNaN(n) ? NaN : n;
  }

  function showError(el, msg) {
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
  }

  /* ==================== 状态 ⇄ 界面同步 ==================== */
  function activeAmountKey() {
    return S.loanType === 'commercial' ? S.commercial : S.fund;
  }
  function activeRateKey() {
    return S.loanType === 'commercial' ? S.commercial : S.fund;
  }

  function isCombined() { return S.loanType === 'combined'; }

  function syncFromState() {
    // tabs
    dom.tabs.forEach(function (tab) {
      var active = tab.dataset.loanType === S.loanType;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    // 单笔 / 组合 区块切换
    dom.singleAmountField.hidden = isCombined();
    dom.singleRateField.hidden = isCombined();
    dom.combinedFields.hidden = !isCombined();
    dom.singleAmountTitle.textContent = LOAN_TYPE_LABEL[S.loanType];
    dom.singleRateTitle.textContent = LOAN_TYPE_LABEL[S.loanType] + ' · 年利率 %';

    // 单笔输入回填（利率按当前贷款方式各记各的：商业 3.5% / 公积金 2.6%）
    dom.amount.value = activeAmountKey().amount;
    dom.amountRange.value = clamp(activeAmountKey().amount, 1, 2000);
    dom.rate.value = activeRateKey().rate;
    // 组合输入回填
    dom.comAmount.value = S.commercial.amount;
    dom.comRate.value = S.commercial.rate;
    dom.fundAmount.value = S.fund.amount;
    dom.fundRate.value = S.fund.rate;
    // 年限
    dom.years.value = S.years;
    dom.yearsRange.value = S.years;
    dom.yearsQuick.forEach(function (btn) {
      btn.classList.toggle('is-active', parseInt(btn.dataset.years, 10) === S.years);
    });
    // 还款方式
    dom.methodRadios.forEach(function (r) {
      r.checked = r.value === S.method;
    });
    // 提前还款
    dom.prepayMonth.value = S.prepay.month == null ? '' : S.prepay.month;
    dom.prepayAmount.value = S.prepay.amount == null ? '' : S.prepay.amount;
    dom.prepayStrategies.forEach(function (r) {
      r.checked = r.value === S.prepay.strategy;
    });
    syncPrepayInputState();
  }

  /** 一次性结清时无需填写金额 */
  function syncPrepayInputState() {
    var isPayoff = S.prepay.strategy === 'payoff';
    dom.prepayAmount.disabled = isPayoff;
    dom.prepayAmount.placeholder = isPayoff ? '结清无需填写' : '还款金额';
  }

  /* ==================== 计算与渲染 ==================== */
  function compute() {
    var parts = [];
    var ok = true;
    dom.saveBtn.disabled = true;
    dom.resultStatus.hidden = true;

    // 清空错误
    showError(dom.amountError, '');
    showError(dom.rateError, '');
    showError(dom.prepayError, '');
    showError(dom.comAmountError, '');
    showError(dom.comRateError, '');
    showError(dom.fundAmountError, '');
    showError(dom.fundRateError, '');
    showError(dom.yearsError, '');

    if (isCombined()) {
      var comAmt = parseNum(dom.comAmount.value);
      var fundAmt = parseNum(dom.fundAmount.value);
      var comRate = parseNum(dom.comRate.value);
      var fundRate = parseNum(dom.fundRate.value);

      // 组合贷款必须同时填写两部分金额（均 > 0）
      var comBad = isNaN(comAmt) || comAmt < 1 || comAmt > 2000;
      var fundBad = isNaN(fundAmt) || fundAmt < 1 || fundAmt > 2000;
      if (comBad) { showError(dom.comAmountError, '请输入 1–2000 万元的商业贷款金额'); ok = false; }
      if (fundBad) { showError(dom.fundAmountError, '请输入 1–2000 万元的公积金贷款金额'); ok = false; }
      if (comAmt > 0 && (isNaN(comRate) || comRate < 0 || comRate > 20)) {
        showError(dom.comRateError, '利率需为 0–20% 的数字');
        ok = false;
      }
      if (fundAmt > 0 && (isNaN(fundRate) || fundRate < 0 || fundRate > 20)) {
        showError(dom.fundRateError, '利率需为 0–20% 的数字');
        ok = false;
      }
      if (!comBad) {
        parts.push({ label: '商业贷款', principal: comAmt * 10000, annualRatePct: comRate });
      }
      if (!fundBad) {
        parts.push({ label: '公积金贷款', principal: fundAmt * 10000, annualRatePct: fundRate });
      }
    } else {
      var amt = parseNum(dom.amount.value);
      var rate = parseNum(dom.rate.value);
      if (isNaN(amt) || amt < 1 || amt > 2000) {
        showError(dom.amountError, '请输入 1–2000 万元的贷款金额');
        ok = false;
      }
      if (isNaN(rate) || rate < 0 || rate > 20) {
        showError(dom.rateError, '利率需为 0–20% 的数字');
        ok = false;
      }
      if (ok) {
        parts.push({
          label: LOAN_TYPE_LABEL[S.loanType],
          principal: amt * 10000,
          annualRatePct: rate
        });
      }
    }

    var yearsNum = parseNum(dom.years.value);
    if (!Number.isInteger(yearsNum) || yearsNum < 1 || yearsNum > 30) {
      showError(dom.yearsError, '贷款年限需为 1–30 的整数');
      ok = false;
    } else {
      S.years = yearsNum;
    }

    // 提前还款参数
    var totalMonths = S.years * 12;
    var prepMonth = parseNum(dom.prepayMonth.value);
    var prepAmountWan = parseNum(dom.prepayAmount.value);
    var monthProvided = dom.prepayMonth.value.trim() !== '';
    var hasMonth = Number.isInteger(prepMonth) && prepMonth > 0;
    var hasAmount = !isNaN(prepAmountWan) && prepAmountWan > 0;
    var strategy = S.prepay.strategy;
    var prepayment = null;

    if (strategy === 'payoff') {
      if (monthProvided) {
        if (!hasMonth) {
          showError(dom.prepayError, '提前还款期数需为正整数');
          ok = false;
        } else if (prepMonth > totalMonths) {
          showError(dom.prepayError, '结清期数需在 1–' + totalMonths + ' 期之间');
          ok = false;
        } else {
          prepayment = { month: Math.floor(prepMonth), amount: 1, strategy: 'payoff' };
        }
      }
    } else if (monthProvided || hasAmount) {
      if (!hasMonth) {
        showError(dom.prepayError, monthProvided ? '提前还款期数需为正整数' : '请填写提前还款期数');
        ok = false;
      } else if (prepMonth > totalMonths) {
        showError(dom.prepayError, '提前还款期数需在 1–' + totalMonths + ' 期之间');
        ok = false;
      } else if (!hasAmount) {
        showError(dom.prepayError, '请填写提前还款金额（万元）');
        ok = false;
      } else {
        prepayment = {
          month: Math.floor(prepMonth),
          amount: round2Jiao(prepAmountWan * 10000),
          strategy: strategy
        };
      }
    }

    if (!ok) {
      dom.resultStatus.hidden = false;
      return;
    }

    var result = MortgageCalc.computeLoan({
      parts: parts,
      method: S.method,
      years: S.years,
      prepayment: prepayment
    });
    if (!result) {
      dom.resultStatus.hidden = false;
      return;
    }
    lastResult = result;
    dom.saveBtn.disabled = false;
    render(result);
  }

  function render(result) {
    var isEP = result.method === 'equalPrincipal';

    // 月供卡片
    dom.monthlyLabel.textContent = isEP ? '首月月供 · 逐月递减' : '每月月供 · 等额还款';
    dom.monthlyValue.textContent = fmtMoney(result.monthly) + ' 元';
    if (result.monthlySplit.length > 1) {
      dom.monthlySplit.textContent = result.monthlySplit.map(function (p) {
        return p.label + ' ' + fmtMoney(p.monthly) + ' 元';
      }).join(' + ');
    } else if (result.method === 'equalPrincipal') {
      dom.monthlySplit.textContent = '平均月供约 ' + fmtMoney(result.totalPayment / result.months) + ' 元';
    } else if (result.prepayment && result.prepayment.strategy === 'shortenTerm') {
      dom.monthlySplit.textContent = '月供不变 · 共 ' + result.months + ' 期';
    } else if (result.prepayment) {
      dom.monthlySplit.textContent = '提前还款后月供 · 原 ' + fmtMoney(result.prepayment.originalMonthly) + ' 元';
    } else {
      dom.monthlySplit.textContent = '月供固定不变';
    }

    // 汇总
    dom.totalValue.textContent = fmtMoney(result.totalPayment) + ' 元';
    dom.interestValue.textContent = fmtMoney(result.totalInterest) + ' 元';
    dom.ratioValue.textContent = (result.totalInterest / result.totalPayment * 100).toFixed(1) + '%';

    // 等额本金补充信息
    if (isEP && result.extra) {
      dom.extraBar.hidden = false;
      dom.extraBar.innerHTML =
        '首月月供 <b>' + fmtMoney(result.extra.monthlyFirst) + '</b> 元 · ' +
        '每月递减 <b>' + fmtMoney(result.extra.monthlyDecrease) + '</b> 元 · ' +
        '末月月供 <b>' + fmtMoney(result.extra.monthlyLast) + '</b> 元';
    } else {
      dom.extraBar.hidden = false;
      dom.extraBar.innerHTML = '等额本息：每月还款额固定，前期还款中利息占比较高，后期本金占比逐渐上升。';
    }

    // 提前还款说明
    renderPrepayBar(result);

    // 图表
    Charts.donut(dom.donutChart, {
      principal: result.principal,
      interest: result.totalInterest
    });
    Charts.line(dom.lineChart, buildLineData(result));

    // 明细表
    renderYearFilter(result);
    renderTable(result);
  }

  function renderPrepayBar(result) {
    var prep = result.prepayment;
    if (!prep) {
      dom.prepayBar.hidden = true;
      dom.prepayBar.innerHTML = '';
      return;
    }
    var isEP = result.method === 'equalPrincipal';
    var ny = prep.newMonths / 12;
    var yearsTxt = (Number.isInteger(ny) ? ny : ny.toFixed(1)) + ' 年';
    var segs = [];
    if (prep.strategy === 'payoff') {
      segs.push('第 <b>' + prep.month + '</b> 期一次性结清');
      segs.push('当期共支付 <b>' + fmtMoney(prep.payoffPayment) + '</b> 元');
      segs.push('共还 <b>' + prep.newMonths + '</b> 期');
    } else {
      segs.push('第 <b>' + prep.month + '</b> 期提前还款 <b>' + fmtMoney(prep.amount) + '</b> 元');
      if (prep.strategy === 'reducePayment') {
        if (isEP) {
          segs.push('次月月供 <b>' + fmtMoney(prep.originalNextMonthly) + '</b> → <b>' +
            fmtMoney(prep.newNextMonthly) + '</b> 元');
        } else {
          segs.push('月供 <b>' + fmtMoney(prep.originalMonthly) + '</b> → <b>' + fmtMoney(prep.newMonthly) + '</b> 元');
        }
      } else {
        segs.push('期限 <b>' + Math.floor(prep.originalMonths / 12) + ' 年</b> → <b>' + yearsTxt + '</b>');
        segs.push(isEP
          ? '每期本金不变（月供仍逐月递减）'
          : '月供 <b>' + fmtMoney(prep.originalMonthly) + '</b> 元不变');
      }
    }
    segs.push('节省利息 <b>' + fmtMoney(prep.savedInterest) + '</b> 元');
    if (prep.clamped) segs.push('⚠ 金额超过剩余本金，已按结清处理');
    dom.prepayBar.hidden = false;
    dom.prepayBar.innerHTML = segs.join('<br>');
  }

  function buildLineData(result) {
    var rows = result.rows;
    var n = rows.length;
    var step = 12;
    var months = [];
    for (var m = 0; m <= n; m += step) months.push(m);
    if (months[months.length - 1] !== n) months.push(n);

    var labels = months.map(function (m) {
      if (m === 0) return '0';
      return m % 12 === 0 ? (m / 12) + '年' : m + '月';
    });

    function seriesPoints(getter) {
      return months.map(function (m) {
        return m === 0 ? getter(null) : getter(rows[m - 1]);
      });
    }

    return {
      labels: labels,
      series: [
        { name: LOAN_TYPE_LABEL[S.loanType] + ' · 剩余本金', color: '#3b82f6', fill: true, points: seriesPoints(function (r) { return r ? r.balance : result.principal; }) },
        { name: '累计还款', color: '#ff6a3d', fill: false, points: seriesPoints(function (r) { return r ? r.cumPayment : 0; }) },
        { name: '累计利息', color: '#f59e0b', fill: false, points: seriesPoints(function (r) { return r ? r.cumInterest : 0; }) }
      ]
    };
  }

  /* ==================== 明细表 ==================== */
  function renderYearFilter(result) {
    var years = result.scheduleYears;
    var prev = dom.yearFilter.value;
    dom.yearFilter.innerHTML = '';
    var all = document.createElement('option');
    all.value = 'all';
    all.textContent = '全部（共 ' + result.months + ' 期）';
    dom.yearFilter.appendChild(all);
    for (var y = 1; y <= years; y++) {
      var opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = '第 ' + y + ' 年';
      dom.yearFilter.appendChild(opt);
    }
    if (prev && dom.yearFilter.querySelector('option[value="' + prev + '"]')) {
      dom.yearFilter.value = prev;
    }
  }

  function renderTable(result) {
    var rows = result.rows;
    var filter = dom.yearFilter.value;
    var start = 0, end = rows.length;

    if (filter !== 'all') {
      var y = parseInt(filter, 10) - 1;
      start = y * 12;
      end = Math.min(start + 12, rows.length);
    }

    var html = '';
    var sumP = 0, sumI = 0, sumPay = 0;
    var prepMonth = result.prepayment ? result.prepayment.month : 0;
    for (var k = start; k < end; k++) {
      var r = rows[k];
      sumPay += r.payment;
      sumP += r.principal;
      sumI += r.interest;
      var rowClass = r.month === prepMonth ? ' class="is-prepay" title="提前还款当期，月供含提前还款额"' : '';
      html += '<tr' + rowClass + '>' +
        '<td class="num">' + r.month + '</td>' +
        '<td class="num">' + fmtMoney(r.payment) + '</td>' +
        '<td class="num">' + fmtMoney(r.principal) + '</td>' +
        '<td class="num">' + fmtMoney(r.interest) + '</td>' +
        '<td class="num">' + fmtMoney(r.balance) + '</td>' +
        '<td class="num">' + fmtMoney(r.cumInterest) + '</td>' +
        '</tr>';
    }
    dom.scheduleBody.innerHTML = html;

    var rangeText = filter === 'all' ? '全部期数' : '第 ' + parseInt(filter, 10) + ' 年';
    dom.tableSectionSummary.innerHTML =
      rangeText + '：<b>' + fmtMoney(sumPay) + '</b> 元 · ' +
      '其中本金 <b>' + fmtMoney(sumP) + '</b> 元，利息 <b>' + fmtMoney(sumI) + '</b> 元';
  }

  /* ==================== 历史记录 ==================== */
  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(LS_HISTORY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    if (!lastResult || dom.saveBtn.disabled) { alert('请先完成有效计算再保存'); return; }
    var list = loadHistory();
    var params = {
      loanType: S.loanType,
      method: S.method,
      years: S.years,
      commercial: { amount: S.commercial.amount, rate: S.commercial.rate },
      fund: { amount: S.fund.amount, rate: S.fund.rate },
      prepay: { month: S.prepay.month, amount: S.prepay.amount, strategy: S.prepay.strategy }
    };
    var item = {
      id: Date.now(),
      time: new Date().toLocaleString('zh-CN', { hour12: false }),
      params: params,
      summary: {
        monthly: lastResult.monthly,
        totalInterest: lastResult.totalInterest,
        totalPayment: lastResult.totalPayment
      }
    };
    list.unshift(item);
    if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
    localStorage.setItem(LS_HISTORY, JSON.stringify(list));
    renderHistory();
  }

  function historyTitle(p) {
    var type = LOAN_TYPE_LABEL[p.loanType];
    var method = METHOD_LABEL[p.method];
    var title;
    if (p.loanType === 'combined') {
      title = type + ' · 商贷 ' + p.commercial.amount + ' 万（' + p.commercial.rate + '%）+ 公积金 ' +
        p.fund.amount + ' 万（' + p.fund.rate + '%）· ' + p.years + ' 年 · ' + method;
    } else {
      var amt = p.loanType === 'commercial' ? p.commercial.amount : p.fund.amount;
      var rate = p.loanType === 'commercial' ? p.commercial.rate : p.fund.rate;
      title = type + ' · ' + amt + ' 万 · ' + p.years + ' 年 · ' + rate + '% · ' + method;
    }
    var pp = p.prepay;
    if (pp && pp.month) {
      var label = pp.strategy === 'payoff' ? '结清'
        : pp.strategy === 'shortenTerm' ? '缩短年限' : '减少月供';
      title += ' · 第' + pp.month + '期提前还' + (pp.amount == null ? '' : pp.amount + '万') + '(' + label + ')';
    }
    return title;
  }

  function renderHistory() {
    var list = loadHistory();
    if (!list.length) {
      dom.historyList.innerHTML = '<p class="history-empty">暂无记录，计算后可点击「保存本次记录」</p>';
      return;
    }
    dom.historyList.innerHTML = list.map(function (item) {
      return '<div class="history-item" data-id="' + item.id + '">' +
        '<div class="history-main">' +
        '<div class="history-title">' + historyTitle(item.params) + '</div>' +
        '<div class="history-meta">' + item.time + ' · 月供 ' + fmtMoney(item.summary.monthly) +
        ' 元 · 总利息 ' + fmtMoney(item.summary.totalInterest) + ' 元</div>' +
        '</div>' +
        '<div class="history-actions">' +
        '<button type="button" class="load">加载</button>' +
        '<button type="button" class="del">删除</button>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function loadHistoryItem(id) {
    var list = loadHistory();
    var item = list.filter(function (i) { return String(i.id) === String(id); })[0];
    if (!item) return;
    S.loanType = item.params.loanType;
    S.method = item.params.method;
    S.years = item.params.years;
    S.commercial = { amount: item.params.commercial.amount, rate: item.params.commercial.rate };
    S.fund = { amount: item.params.fund.amount, rate: item.params.fund.rate };
    var pp = item.params.prepay;
    S.prepay = pp
      ? { month: numOr(pp.month, null), amount: numOr(pp.amount, null), strategy: pp.strategy || 'reducePayment' }
      : { month: null, amount: null, strategy: 'reducePayment' };
    persistState();
    syncFromState();
    compute();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function deleteHistoryItem(id) {
    var list = loadHistory().filter(function (i) { return String(i.id) !== String(id); });
    localStorage.setItem(LS_HISTORY, JSON.stringify(list));
    renderHistory();
  }

  /* ==================== 状态持久化 ==================== */
  function persistState() {
    try {
      localStorage.setItem(LS_STATE, JSON.stringify(S));
    } catch (e) { /* 忽略 */ }
  }

  function numOr(v, def) {
    var n = parseNum(v);
    return isNaN(n) ? def : n;
  }

  function restoreState() {
    try {
      var raw = localStorage.getItem(LS_STATE);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && saved.loanType && saved.commercial && saved.fund) {
        S.loanType = saved.loanType;
        S.method = saved.method || 'annuity';
        S.years = clamp(parseInt(saved.years, 10) || 30, 1, 30);
        S.commercial.amount = numOr(saved.commercial.amount, 100);
        S.commercial.rate = numOr(saved.commercial.rate, 3.5);
        S.fund.amount = numOr(saved.fund.amount, 100);
        S.fund.rate = numOr(saved.fund.rate, 2.6);
        if (saved.prepay && typeof saved.prepay === 'object') {
          S.prepay = {
            month: numOr(saved.prepay.month, null),
            amount: numOr(saved.prepay.amount, null),
            strategy: saved.prepay.strategy || 'reducePayment'
          };
        }
      }
    } catch (e) { /* 忽略 */ }
  }

  /* ==================== 事件绑定 ==================== */
  function bindEvents() {
    // 贷款方式 tabs
    dom.tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        S.loanType = tab.dataset.loanType;
        persistState();
        syncFromState();
        compute();
      });
    });

    // 还款方式
    dom.methodRadios.forEach(function (r) {
      r.addEventListener('change', function () {
        S.method = r.value;
        persistState();
        compute();
      });
    });

    // 单笔金额：输入 + 滑杆双向
    dom.amount.addEventListener('input', function () {
      if (isCombined()) return; // 组合模式使用独立的两个金额输入框
      var v = parseNum(dom.amount.value);
      if (!isNaN(v) && v >= 1 && v <= 2000) {
        activeAmountKey().amount = v;
        dom.amountRange.value = clamp(v, 1, 2000);
      }
      persistState();
      compute();
    });
    dom.amountRange.addEventListener('input', function () {
      if (isCombined()) return;
      var v = parseInt(dom.amountRange.value, 10);
      dom.amount.value = v;
      if (S.loanType === 'commercial') S.commercial.amount = v; else S.fund.amount = v;
      persistState();
      compute();
    });

    // 组合金额
    dom.comAmount.addEventListener('input', function () {
      var v = parseNum(dom.comAmount.value);
      if (!isNaN(v) && v >= 0) S.commercial.amount = v;
      persistState();
      compute();
    });
    dom.fundAmount.addEventListener('input', function () {
      var v = parseNum(dom.fundAmount.value);
      if (!isNaN(v) && v >= 0) S.fund.amount = v;
      persistState();
      compute();
    });

    // 年限：输入 + 滑杆 + 快捷按钮
    dom.years.addEventListener('input', function () {
      var v = parseNum(dom.years.value);
      if (Number.isInteger(v) && v >= 1 && v <= 30) {
        S.years = v;
        dom.yearsRange.value = v;
        dom.yearsQuick.forEach(function (b) {
          b.classList.toggle('is-active', parseInt(b.dataset.years, 10) === v);
        });
      }
      persistState();
      compute();
    });
    dom.yearsRange.addEventListener('input', function () {
      var v = parseInt(dom.yearsRange.value, 10);
      dom.years.value = v;
      S.years = v;
      dom.yearsQuick.forEach(function (b) {
        b.classList.toggle('is-active', parseInt(b.dataset.years, 10) === v);
      });
      persistState();
      compute();
    });
    dom.yearsQuick.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = parseInt(btn.dataset.years, 10);
        dom.years.value = v;
        dom.yearsRange.value = v;
        S.years = v;
        dom.yearsQuick.forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        persistState();
        compute();
      });
    });

    // 贷款利率（单笔模式：按当前贷款方式写入各自的利率）
    dom.rate.addEventListener('input', function () {
      if (isCombined()) return; // 组合模式使用独立的两个利率输入框
      var v = parseNum(dom.rate.value);
      if (!isNaN(v) && v >= 0 && v <= 20) activeRateKey().rate = v;
      persistState();
      compute();
    });

    // 组合贷款 · 商业部分利率
    dom.comRate.addEventListener('input', function () {
      var v = parseNum(dom.comRate.value);
      if (!isNaN(v) && v >= 0 && v <= 20) S.commercial.rate = v;
      persistState();
      compute();
    });

    // 组合贷款 · 公积金部分利率
    dom.fundRate.addEventListener('input', function () {
      var v = parseNum(dom.fundRate.value);
      if (!isNaN(v) && v >= 0 && v <= 20) S.fund.rate = v;
      persistState();
      compute();
    });

    // 提前还款：期数 / 金额 / 处理方式
    dom.prepayMonth.addEventListener('input', function () {
      var v = parseNum(dom.prepayMonth.value);
      S.prepay.month = (!isNaN(v) && v > 0) ? v : null;
      persistState();
      compute();
    });
    dom.prepayAmount.addEventListener('input', function () {
      var v = parseNum(dom.prepayAmount.value);
      S.prepay.amount = (!isNaN(v) && v > 0) ? v : null;
      persistState();
      compute();
    });
    dom.prepayStrategies.forEach(function (r) {
      r.addEventListener('change', function () {
        S.prepay.strategy = r.value;
        syncPrepayInputState();
        persistState();
        compute();
      });
    });

    // 按钮
    dom.calcBtn.addEventListener('click', compute);
    dom.saveBtn.addEventListener('click', saveHistory);

    // 年筛选
    dom.yearFilter.addEventListener('change', function () {
      if (lastResult) renderTable(lastResult);
    });

    // 历史操作（事件委托）
    dom.historyList.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var itemEl = btn.closest('.history-item');
      if (!itemEl) return;
      var id = itemEl.dataset.id;
      if (btn.classList.contains('load')) loadHistoryItem(id);
      else if (btn.classList.contains('del')) deleteHistoryItem(id);
    });
    dom.clearHistory.addEventListener('click', function () {
      if (!loadHistory().length) return;
      if (confirm('确定清空全部历史记录吗？')) {
        localStorage.setItem(LS_HISTORY, '[]');
        renderHistory();
      }
    });
  }

  /* ==================== 启动 ==================== */
  function boot() {
    restoreState();
    bindEvents();
    syncFromState();
    compute();
    renderHistory();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
