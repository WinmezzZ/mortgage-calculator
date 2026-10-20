/**
 * 房贷计算核心（纯函数，零依赖）
 * UMD 导出：浏览器挂载 window.MortgageCalc，Node 端 module.exports。
 *
 * 公式约定：
 *   r = 年利率(%) ÷ 100 ÷ 12（月利率）
 *   n = 年限 × 12（期数）
 *   等额本息：月供 M = P·r·(1+r)^n / ((1+r)^n − 1)，r=0 时 M = P/n
 *   等额本金：每期本金 P/n，第 k 期利息 = (P − (k−1)·P/n)·r
 *
 * 提前还款：
 *   第 k 期正常还款后追加一笔本金，三种处理方式
 *   reducePayment 减少月供（期限不变）｜shortenTerm 缩短年限（月供不变）｜payoff 一次性结清
 *   组合贷款按各部分当期剩余本金比例分摊提前还款额。
 *
 * 金额精度：行内每个金额四舍五入到分（2 位小数）；
 * 累计值由逐行累加得到，保证「明细表之和 === 汇总卡片」。
 * 末期为尾差修正行，剩余本金精确归零。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MortgageCalc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 四舍五入到分 */
  function round2(x) {
    return Math.round((x + Number.EPSILON) * 100) / 100;
  }

  /** 归一化显示余额：避免浮点残留的 -0/-0.00 */
  function normBalance(x) {
    const v = round2(x);
    return v === 0 ? 0 : v;
  }

  /** 等额本息月供 */
  function annuityPayment(principal, monthlyRate, periods) {
    if (periods <= 0) return principal;
    if (monthlyRate === 0) return principal / periods;
    const f = Math.pow(1 + monthlyRate, periods);
    return (principal * monthlyRate * f) / (f - 1);
  }

  /** 给定月供，反解可还清的期数（用于缩短年限）；无解返回 null */
  function solvePeriods(balance, monthlyRate, payment) {
    if (monthlyRate === 0) return balance / payment;
    const denom = 1 - (balance * monthlyRate) / payment;
    if (denom <= 0) return null;
    return -Math.log(denom) / Math.log(1 + monthlyRate);
  }

  /**
   * 等额本息
   * @param {number} principal 贷款本金（元）
   * @param {number} annualRatePct 年利率（%，如 3.0）
   * @param {number} years 贷款年限（整数，1-30）
   * @returns {{monthly:number, totalPayment:number, totalInterest:number, rows:Array}}
   */
  function computeAnnuity(principal, annualRatePct, years) {
    const n = years * 12;
    const r = annualRatePct / 100 / 12;
    const monthly = r === 0
      ? principal / n
      : (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

    let balance = principal;   // 浮点追踪真实余额
    let cumPayment = 0;
    let cumInterest = 0;
    const rows = [];

    for (let k = 1; k <= n; k++) {
      let interest = balance * r;
      let principalPart = monthly - interest;
      if (k === n) principalPart = balance; // 末行尾差修正

      const interestR = round2(interest);
      const principalR = k === n ? round2(balance) : round2(principalPart);
      const paymentR = round2(principalR + interestR);
      // 余额按取整后的本金递减，保持分精度；末行差额被 principalR 吸收，Σ本金恒等于 P
      balance -= principalR;

      cumPayment = round2(cumPayment + paymentR);
      cumInterest = round2(cumInterest + interestR);

      rows.push({
        month: k,
        payment: paymentR,
        principal: principalR,
        interest: interestR,
        balance: normBalance(balance),
        cumPayment: cumPayment,
        cumInterest: cumInterest
      });
    }

    return {
      monthly: round2(monthly),
      totalPayment: round2(principal + cumInterest),
      totalInterest: cumInterest,
      rows: rows
    };
  }

  /**
   * 等额本金
   */
  function computeEqualPrincipal(principal, annualRatePct, years) {
    const n = years * 12;
    const r = annualRatePct / 100 / 12;
    const perPrincipal = principal / n;

    let balance = principal;
    let cumPayment = 0;
    let cumInterest = 0;
    const rows = [];

    for (let k = 1; k <= n; k++) {
      const interest = balance * r;
      const interestR = round2(interest);
      const principalR = k === n ? round2(balance) : round2(perPrincipal);
      const paymentR = round2(principalR + interestR);
      balance -= principalR;

      cumPayment = round2(cumPayment + paymentR);
      cumInterest = round2(cumInterest + interestR);

      rows.push({
        month: k,
        payment: paymentR,
        principal: principalR,
        interest: interestR,
        balance: normBalance(balance),
        cumPayment: cumPayment,
        cumInterest: cumInterest
      });
    }

    return {
      monthly: round2(rows[0].payment), // 首个完整月的还款额
      monthlyFirst: round2(rows[0].payment),
      monthlyLast: round2(rows[n - 1].payment),
      monthlyDecrease: round2((perPrincipal) * r),
      totalPayment: round2(principal + cumInterest),
      totalInterest: cumInterest,
      rows: rows
    };
  }

  /**
   * 单个贷款部分（可含一笔提前还款）的还款计划
   * @param {number} principal
   * @param {number} annualRatePct
   * @param {number} years
   * @param {'annuity'|'equalPrincipal'} method
   * @param {?{month:number, amount:number, strategy:string}} prep
   */
  function computePart(principal, annualRatePct, years, method, prep) {
    const n = years * 12;
    const r = annualRatePct / 100 / 12;
    // annuity: 月供；equalPrincipal: 每期本金
    let planPayment = method === 'annuity'
      ? annuityPayment(principal, r, n)
      : principal / n;

    const usePrepay = !!prep && prep.month >= 1 && prep.month <= n && prep.amount > 0;
    let endMonth = n;
    let balance = principal;
    let cumPayment = 0;
    let cumInterest = 0;
    const rows = [];
    let prepMeta = null;

    for (let k = 1; k <= endMonth; k++) {
      const interest = balance * r;
      const interestR = round2(interest);
      const isFinal = (k === endMonth);

      let regular;
      if (method === 'annuity') {
        regular = isFinal ? balance : planPayment - interest;
      } else {
        regular = isFinal ? balance : planPayment;
      }

      // 第 k 期正常还款后追加提前还款
      let prepNow = 0;
      if (usePrepay && k === prep.month && !prepMeta) {
        const afterRegular = round2(balance - round2(regular));
        let strategy = prep.strategy === 'payoff' || prep.strategy === 'shortenTerm'
          ? prep.strategy
          : 'reducePayment';
        let amount = strategy === 'payoff'
          ? afterRegular
          : Math.min(round2(prep.amount), afterRegular);
        amount = round2(Math.max(0, amount));
        const newBalance = round2(afterRegular - amount);
        const remaining = endMonth - k;
        prepNow = amount;

        if (strategy === 'payoff' || newBalance <= 0.004 || remaining <= 0) {
          endMonth = k;
        } else if (strategy === 'shortenTerm') {
          if (method === 'annuity') {
            const m = solvePeriods(newBalance, r, planPayment);
            if (m !== null && m >= 1) {
              endMonth = k + Math.ceil(m);
            } else {
              // 月供不足以覆盖利息，退化为「减少月供」
              strategy = 'reducePayment';
              endMonth = k + remaining;
              planPayment = method === 'annuity'
                ? annuityPayment(newBalance, r, remaining)
                : newBalance / remaining;
            }
          } else {
            const m2 = Math.ceil(round2(newBalance / planPayment));
            endMonth = k + Math.max(1, m2);
          }
        } else {
          // reducePayment：期限不变，剩余期数重新均摊
          planPayment = method === 'annuity'
            ? annuityPayment(newBalance, r, remaining)
            : newBalance / remaining;
        }

        prepMeta = {
          month: k,
          amount: amount,
          strategy: strategy,
          requestedStrategy: prep.strategy,
          endMonth: endMonth,
          clamped: amount < round2(prep.amount)
        };
      }

      const principalR = round2(regular) + prepNow;
      const paymentR = round2(principalR + interestR);
      balance -= principalR; // 余额按取整后的本金递减，保持分精度

      cumPayment = round2(cumPayment + paymentR);
      cumInterest = round2(cumInterest + interestR);

      rows.push({
        month: k,
        payment: paymentR,
        principal: principalR,
        interest: interestR,
        balance: normBalance(balance),
        cumPayment: cumPayment,
        cumInterest: cumInterest
      });
    }

    return {
      monthly: method === 'annuity' ? round2(planPayment) : rows[0].payment,
      monthlyFirst: rows[0].payment,
      monthlyLast: rows[rows.length - 1].payment,
      monthlyDecrease: round2(planPayment * r),
      totalPayment: round2(principal + cumInterest),
      totalInterest: cumInterest,
      rows: rows,
      prepMeta: prepMeta
    };
  }

  /** 合并多个部分的逐月计划（允许各部分长度不同，如组合贷款缩短年限时） */
  function mergeParts(results, principalTotal) {
    const maxLen = results.reduce(function (m, res) {
      return Math.max(m, res.rows.length);
    }, 0);
    const rows = [];
    let cumPayment = 0;
    let cumInterest = 0;

    for (let k = 0; k < maxLen; k++) {
      let payment = 0, principal = 0, interest = 0, balance = 0;
      results.forEach(function (res) {
        const row = res.rows[k];
        if (row) {
          payment += row.payment;
          principal += row.principal;
          interest += row.interest;
          balance += row.balance;
        }
      });
      cumPayment = round2(cumPayment + round2(payment));
      cumInterest = round2(cumInterest + round2(interest));
      rows.push({
        month: k + 1,
        payment: round2(payment),
        principal: round2(principal),
        interest: round2(interest),
        balance: round2(balance),
        cumPayment: cumPayment,
        cumInterest: cumInterest
      });
    }

    return {
      rows: rows,
      totalInterest: cumInterest,
      totalPayment: round2(principalTotal + cumInterest)
    };
  }

  /**
   * 校验输入，返回 {ok, errors}
   */
  function validateInputs(parts, method, years) {
    const errors = [];
    if (!parts || parts.length === 0) errors.push('缺少贷款部分');
    let hasPositive = false;
    (parts || []).forEach(function (part, i) {
      if (typeof part.principal !== 'number' || !isFinite(part.principal) || part.principal <= 0) {
        errors.push((i + 1) + ' 号贷款部分金额无效');
      } else {
        hasPositive = true;
      }
      if (typeof part.annualRatePct !== 'number' || !isFinite(part.annualRatePct) ||
          part.annualRatePct < 0 || part.annualRatePct > 20) {
        errors.push((i + 1) + ' 号贷款部分利率无效');
      }
    });
    if (!hasPositive) errors.push('请至少填写一项贷款金额');
    if (method !== 'annuity' && method !== 'equalPrincipal') errors.push('还款方式无效');
    if (!Number.isInteger(years) || years < 1 || years > 50) errors.push('贷款年限需为 1-50 的整数');
    return { ok: errors.length === 0, errors: errors };
  }

  /**
   * 组合/单笔贷款统一入口（支持一笔提前还款）
   * @param {object} opts {
   *   parts:[{principal,annualRatePct,label?}],
   *   method:'annuity'|'equalPrincipal',
   *   years:number,
   *   prepayment?:{month:number, amount:number, strategy:'reducePayment'|'shortenTerm'|'payoff'}
   * }
   * @returns 结果对象或 null（输入非法时）
   */
  function computeLoan(opts) {
    const parts = opts.parts;
    const method = opts.method;
    const years = opts.years;
    const check = validateInputs(parts, method, years);
    if (!check.ok) return null;

    const n = years * 12;
    const principalTotal = parts.reduce(function (a, p) { return a + p.principal; }, 0);
    const prep = opts.prepayment;

    // 无提前还款的基准计划（同时用于计算节省的利息）
    const baseResults = parts.map(function (part) {
      return computePart(part.principal, part.annualRatePct, years, method, null);
    });
    const baseMerged = mergeParts(baseResults, principalTotal);

    let results = baseResults;
    let prepInfo = null;

    if (prep && prep.amount > 0 && Number.isInteger(prep.month) && prep.month >= 1 && prep.month <= n) {
      const month = prep.month;
      const strategy = prep.strategy === 'shortenTerm' || prep.strategy === 'payoff'
        ? prep.strategy
        : 'reducePayment';

      // 组合贷款：按该月各部分剩余本金比例分摊提前还款额
      const balancesAt = baseResults.map(function (res) {
        const row = res.rows[month - 1];
        return row ? row.balance : 0;
      });
      const totalBalance = balancesAt.reduce(function (a, b) { return a + b; }, 0);
      let assigned = 0;
      const shares = parts.map(function (_, i) {
        let amt = totalBalance > 0
          ? round2(prep.amount * (balancesAt[i] / totalBalance))
          : (i === 0 ? prep.amount : 0);
        if (i === parts.length - 1) amt = round2(prep.amount - assigned); // 尾差归最后一部分
        assigned = round2(assigned + amt);
        return amt;
      });

      results = parts.map(function (part, i) {
        return computePart(part.principal, part.annualRatePct, years, method, {
          month: month,
          amount: shares[i],
          strategy: strategy
        });
      });

      const metas = results.map(function (res) { return res.prepMeta; }).filter(Boolean);
      const totalAmount = round2(metas.reduce(function (a, m) { return a + m.amount; }, 0));
      const sumPayAt = function (resList, idx) {
        return round2(resList.reduce(function (a, res) {
          return a + (res.rows[idx] ? res.rows[idx].payment : 0);
        }, 0));
      };
      prepInfo = {
        month: month,
        amount: totalAmount,
        strategy: metas.some(function (m) { return m.strategy === 'reducePayment'; }) && strategy !== 'reducePayment'
          ? 'reducePayment'
          : strategy,
        requestedStrategy: strategy,
        clamped: metas.some(function (m) { return m.clamped; }),
        parts: metas.map(function (m) { return { amount: m.amount, month: m.month, strategy: m.strategy }; }),
        // 提前还款后第一个月的月供（等额本金用于展示「次月月供」变化）
        originalNextMonthly: sumPayAt(baseResults, month),
        newNextMonthly: sumPayAt(results, month),
        // 结清当期的实际总支付（正常月供 + 结清款）
        payoffPayment: sumPayAt(results, month - 1)
      };
    }

    const merged = (results === baseResults) ? baseMerged : mergeParts(results, principalTotal);

    const monthlySplit = parts.map(function (part, i) {
      return { label: part.label || ('部分' + (i + 1)), monthly: results[i].monthly };
    });

    const isEP = method === 'equalPrincipal';
    const result = {
      method: method,
      years: years,
      months: merged.rows.length,
      scheduleYears: Math.ceil(merged.rows.length / 12),
      principal: principalTotal,
      monthly: round2(results.reduce(function (a, res) { return a + res.monthly; }, 0)),
      totalPayment: merged.totalPayment,
      totalInterest: merged.totalInterest,
      rows: merged.rows,
      monthlySplit: monthlySplit,
      extra: isEP
        ? {
            monthlyFirst: merged.rows[0].payment,
            monthlyLast: merged.rows[merged.rows.length - 1].payment,
            monthlyDecrease: round2(results.reduce(function (a, res) { return a + res.monthlyDecrease; }, 0))
          }
        : null,
      prepayment: prepInfo
        ? {
            month: prepInfo.month,
            amount: prepInfo.amount,
            strategy: prepInfo.strategy,
            clamped: prepInfo.clamped,
            originalMonths: n,
            newMonths: merged.rows.length,
            originalMonthly: round2(baseResults.reduce(function (a, res) { return a + res.monthly; }, 0)),
            newMonthly: round2(results.reduce(function (a, res) { return a + res.monthly; }, 0)),
            originalInterest: baseMerged.totalInterest,
            newInterest: merged.totalInterest,
            savedInterest: round2(baseMerged.totalInterest - merged.totalInterest),
            originalNextMonthly: prepInfo.originalNextMonthly,
            newNextMonthly: prepInfo.newNextMonthly,
            payoffPayment: prepInfo.payoffPayment
          }
        : null
    };

    return result;
  }

  return {
    computeAnnuity: computeAnnuity,
    computeEqualPrincipal: computeEqualPrincipal,
    computeLoan: computeLoan,
    validateInputs: validateInputs,
    round2: round2
  };
});
