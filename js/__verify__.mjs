/**
 * 计算核心验证脚本（Node 运行，非页面代码）
 *   node js/__verify__.mjs
 * 断言覆盖：等额本息锚点值、行内一致性、等额本金递减规律、
 * 组合贷款拆分合并、利率 0 退化、非法输入防护。
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const Calc = require('./calculator.js');

const R = Calc.round2;

function approx(a, b, eps = 0.02, msg = '') {
  assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} (±${eps}) ${msg}`);
}

console.log('等额本息：100 万 / 30 年 / 4.2%');
{
  const res = Calc.computeAnnuity(1000000, 4.2, 30);
  // 锚点：该组合的月供在 4890 元左右
  approx(res.monthly, 4890, 1.5, '月供锚点');
  // 行内一致性
  const sumP = R(res.rows.reduce((s, r) => s + r.principal, 0));
  approx(sumP, 1000000, 0.011, 'Σ本金 = 本金');
  approx(res.rows[res.rows.length - 1].balance, 0, 0.011, '末行剩余本金归零');
  approx(res.totalPayment, res.totalInterest + 1000000, 0.011, '还款总额 - 利息 = 本金');
  approx(res.rows[res.rows.length - 1].cumPayment, res.totalPayment, 0.011, '累计月供 = 还款总额');
  assert.ok(res.rows.every(r => R(r.payment - r.principal - r.interest) === 0), '每行 月供=本金+利息');
}

console.log('等额本金：80 万 / 20 年 / 3.6%');
{
  const P = 800000, n = 240, r = 0.036 / 12;
  const res = Calc.computeEqualPrincipal(P, 3.6, 20);
  approx(res.rows[0].payment, R(P / n + P * r), 0.02, '首月月供');
  // 末行按“分精度余额”吸收取整差额：本金 = P − (n−1)·round2(P/n)
  const principalLast = R(P - (n - 1) * R(P / n));
  const interestLast = R(principalLast * r);
  approx(res.rows[n - 1].payment, R(principalLast + interestLast), 0.02, '末月月供（含取整差额）');
  approx(res.rows[n - 1].principal, principalLast, 0.011, '末月本金吸收差额');
  const dec = R((P / n) * r);
  approx(res.rows[0].payment - res.rows[1].payment, dec, 0.02, '每月递减额');
  approx(res.rows[100].payment - res.rows[101].payment, dec, 0.02, '中段递减额');
  const sumP = R(res.rows.reduce((s, row) => s + row.principal, 0));
  approx(sumP, P, 0.011, 'Σ本金 = 本金');
  approx(res.rows[n - 1].balance, 0, 0.011, '末行剩余本金归零');
}

console.log('组合贷款：商贷 60 万 / 4.2% + 公积金 40 万 / 3.1%，等额本息 30 年');
{
  const com = Calc.computeAnnuity(600000, 4.2, 30);
  const fund = Calc.computeAnnuity(400000, 3.1, 30);
  const res = Calc.computeLoan({
    parts: [
      { label: '商贷', principal: 600000, annualRatePct: 4.2 },
      { label: '公积金', principal: 400000, annualRatePct: 3.1 }
    ],
    method: 'annuity',
    years: 30
  });
  assert.ok(res && res.monthlySplit.length === 2, '拆分信息存在');
  approx(res.monthly, com.monthly + fund.monthly, 0.02, '月供 = 两部分之和');
  for (const k of [0, 59, 119, 359]) {
    approx(res.rows[k].payment, com.rows[k].payment + fund.rows[k].payment, 0.02, `第${k + 1}期月供`);
  }
  approx(res.totalInterest, com.totalInterest + fund.totalInterest, 0.02, '总利息 = 两部分之和');
  approx(res.rows[359].balance, 0, 0.011, '组合末行余额归零');
  const sumP = R(res.rows.reduce((s, row) => s + row.principal, 0));
  approx(sumP, 1000000, 0.011, 'Σ本金 = 100 万');
}

console.log('组合贷款（等额本金）：50 万 + 50 万 / 30 年');
{
  const res = Calc.computeLoan({
    parts: [
      { label: '商贷', principal: 500000, annualRatePct: 3.6 },
      { label: '公积金', principal: 500000, annualRatePct: 2.85 }
    ],
    method: 'equalPrincipal',
    years: 30
  });
  const dec = R((500000 / 360) * (0.036 / 12) + (500000 / 360) * (0.0285 / 12));
  approx(res.rows[0].payment - res.rows[1].payment, dec, 0.02, '组合每月递减额');
  approx(res.rows[359].balance, 0, 0.011, '末行余额归零');
  // 等额本金首月 > 末月
  assert.ok(res.rows[0].payment > res.rows[359].payment, '首月高于末月');
  console.log('        首月 ' + res.rows[0].payment + ' 元 → 末月 ' + res.rows[359].payment + ' 元');
}

console.log('利率为 0 的退化');
{
  const res = Calc.computeAnnuity(100000, 0, 10);
  approx(res.monthly, R(100000 / 120), 0.011, '月供 = round2(P/n)');
  assert.equal(res.totalInterest, 0, '总利息 = 0');
  assert.ok(res.rows.every(row => row.interest === 0), '各行利息 = 0');
}

console.log('非法输入防护');
{
  assert.equal(Calc.computeLoan({ parts: [{ principal: 0, annualRatePct: 3 }], method: 'annuity', years: 30 }), null, '金额 0');
  assert.equal(Calc.computeLoan({ parts: [{ principal: 100, annualRatePct: 3 }], method: 'annuity', years: 0 }), null, '年限 0');
  assert.equal(Calc.computeLoan({ parts: [{ principal: 100, annualRatePct: -1 }], method: 'annuity', years: 30 }), null, '负利率');
  const t = Calc.computeLoan({ parts: [{ principal: 100, annualRatePct: 3 }], method: 'annuity', years: 30 });
  assert.ok(t, '合法输入不返回 null');
}


console.log('提前还款 · 等额本息：100 万 / 30 年 / 4.2%，第 60 期还 20 万（减少月供）');
{
  const base = Calc.computeLoan({
    parts: [{ principal: 1000000, annualRatePct: 4.2 }], method: 'annuity', years: 30
  });
  const res = Calc.computeLoan({
    parts: [{ principal: 1000000, annualRatePct: 4.2 }], method: 'annuity', years: 30,
    prepayment: { month: 60, amount: 200000, strategy: 'reducePayment' }
  });
  assert.ok(res && res.prepayment, '提前还款元数据存在');
  assert.equal(res.rows.length, 360, '减少月供 → 期数不变');
  approx(base.rows[59].balance - res.rows[59].balance, 200000, 0.02, '还款当期剩余本金下降 20 万');
  approx(res.rows[59].principal, base.rows[59].principal + 200000, 0.02, '当期本金含提前还款额');
  approx(res.rows[59].interest, base.rows[59].interest, 0.02, '当期利息不受影响');
  assert.ok(res.prepayment.newMonthly < res.prepayment.originalMonthly, '新月供低于原月供');
  assert.ok(res.prepayment.savedInterest > 0, '节省利息 > 0');
  approx(res.prepayment.savedInterest, base.totalInterest - res.totalInterest, 0.02, '节省利息一致');
  approx(res.rows.reduce((s, r) => s + r.principal, 0), 1000000, 0.011, 'Σ本金 = 100 万');
  approx(res.rows[359].balance, 0, 0.011, '末行余额归零');
  console.log('        月供 ' + res.prepayment.originalMonthly + ' → ' + res.prepayment.newMonthly +
    ' 元，节省利息 ' + res.prepayment.savedInterest + ' 元');
}

console.log('提前还款 · 缩短年限（月供不变）');
{
  const base = Calc.computeLoan({
    parts: [{ principal: 1000000, annualRatePct: 4.2 }], method: 'annuity', years: 30
  });
  const res = Calc.computeLoan({
    parts: [{ principal: 1000000, annualRatePct: 4.2 }], method: 'annuity', years: 30,
    prepayment: { month: 60, amount: 200000, strategy: 'shortenTerm' }
  });
  const reduce = Calc.computeLoan({
    parts: [{ principal: 1000000, annualRatePct: 4.2 }], method: 'annuity', years: 30,
    prepayment: { month: 60, amount: 200000, strategy: 'reducePayment' }
  });
  assert.ok(res.rows.length < 360, '期限缩短');
  approx(res.monthly, base.monthly, 0.02, '月供不变');
  approx(res.rows[res.rows.length - 1].balance, 0, 0.011, '末行余额归零');
  approx(res.rows.reduce((s, r) => s + r.principal, 0), 1000000, 0.011, 'Σ本金 = 100 万');
  assert.ok(res.prepayment.savedInterest > reduce.prepayment.savedInterest, '缩短年限省息更多');
  console.log('        期数 ' + res.prepayment.originalMonths + ' → ' + res.prepayment.newMonths +
    '，节省利息 ' + res.prepayment.savedInterest + ' 元');
}

console.log('提前还款 · 一次性结清');
{
  const base = Calc.computeLoan({
    parts: [{ principal: 1000000, annualRatePct: 4.2 }], method: 'annuity', years: 30
  });
  const res = Calc.computeLoan({
    parts: [{ principal: 1000000, annualRatePct: 4.2 }], method: 'annuity', years: 30,
    prepayment: { month: 60, amount: 1, strategy: 'payoff' }
  });
  assert.equal(res.rows.length, 60, '结清后期数止于第 60 期');
  approx(res.rows[59].balance, 0, 0.011, '结清余额为 0');
  approx(res.rows[59].payment, base.rows[58].balance + res.rows[59].interest, 0.02, '当期月供 = 期初剩余本金 + 当期利息');
  assert.ok(res.totalInterest < base.totalInterest, '总利息减少');
  approx(res.totalInterest, base.rows.slice(0, 59).reduce((s, r) => s + r.interest, 0) + res.rows[59].interest, 0.02, '总利息 = 已付利息');
}

console.log('提前还款 · 等额本金（减少月供）');
{
  const base = Calc.computeLoan({
    parts: [{ principal: 1000000, annualRatePct: 4.2 }], method: 'equalPrincipal', years: 30
  });
  const res = Calc.computeLoan({
    parts: [{ principal: 1000000, annualRatePct: 4.2 }], method: 'equalPrincipal', years: 30,
    prepayment: { month: 60, amount: 200000, strategy: 'reducePayment' }
  });
  assert.equal(res.rows.length, 360, '期限不变');
  assert.ok(res.rows[60].payment < base.rows[60].payment, '下一期月供降低');
  approx(res.rows.reduce((s, r) => s + r.principal, 0), 1000000, 0.011, 'Σ本金 = 100 万');
  approx(res.rows[359].balance, 0, 0.011, '末行余额归零');
}

console.log('提前还款 · 组合贷款按剩余本金比例分摊');
{
  const res = Calc.computeLoan({
    parts: [
      { label: '商贷', principal: 600000, annualRatePct: 4.2 },
      { label: '公积金', principal: 400000, annualRatePct: 2.6 }
    ],
    method: 'annuity', years: 30,
    prepayment: { month: 36, amount: 300000, strategy: 'reducePayment' }
  });
  approx(res.prepayment.amount, 300000, 0.02, '分摊总额 = 30 万');
  assert.ok(res.prepayment.savedInterest > 0, '节省利息 > 0');
  assert.equal(res.rows.length, 360, '期限不变');
  approx(res.rows[res.rows.length - 1].balance, 0, 0.011, '末行余额归零');
}

console.log('提前还款 · 边界情况');
{
  const late = Calc.computeLoan({
    parts: [{ principal: 100000, annualRatePct: 3 }], method: 'annuity', years: 10,
    prepayment: { month: 500, amount: 1000, strategy: 'reducePayment' }
  });
  assert.equal(late.prepayment, null, '超出期数 → 忽略提前还款');
  assert.equal(late.rows.length, 120, '期数不变');

  const fractional = Calc.computeLoan({
    parts: [{ principal: 100000, annualRatePct: 3 }], method: 'annuity', years: 10,
    prepayment: { month: 1.9, amount: 1000, strategy: 'reducePayment' }
  });
  assert.equal(fractional.prepayment, null, '非整数提前还款期数 → 忽略提前还款');
  assert.equal(fractional.rows.length, 120, '非整数期数不应被截断');

  const over = Calc.computeLoan({
    parts: [{ principal: 100000, annualRatePct: 3 }], method: 'annuity', years: 10,
    prepayment: { month: 2, amount: 9999999, strategy: 'reducePayment' }
  });
  assert.ok(over.prepayment.clamped, '超额被截断');
  assert.equal(over.rows.length, 2, '等效于提前结清');
  approx(over.rows[1].balance, 0, 0.011, '结清余额为 0');
}

console.log('\n全部断言通过 ✓');
