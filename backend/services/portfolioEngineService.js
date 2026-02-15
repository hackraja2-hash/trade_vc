const { connect } = require('../db/connection');

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function round2(value) {
  return Math.round((toNum(value) + Number.EPSILON) * 100) / 100;
}

function parseDate(value) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function daysBetween(start, end) {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e) return 0;
  return Math.max(0, Math.floor((e.getTime() - s.getTime()) / 86400000));
}

function taxType(daysHeld) {
  return daysHeld >= 365 ? 'Long Term' : 'Short Term';
}

function computeInterest(principal, dailyPct, days, multiplier, totalType) {
  if (principal <= 0 || days <= 0) return 0;
  const rate = toNum(dailyPct) / 100;
  const lev = toNum(multiplier) || 1;
  if (String(totalType || '').toLowerCase() === 'compounded') {
    return principal * (Math.pow(1 + (rate * lev), days) - 1);
  }
  return principal * rate * days * lev;
}

async function getActiveMtfConfig(pool) {
  const result = await pool.request().query(`
    SELECT TOP 1 id, mtf_daily_interest_pct, mtf_total_pct_type, mtf_leverage_multiplier, effective_from
    FROM dbo.charges_config
    WHERE is_active = 1
    ORDER BY effective_from DESC, id DESC
  `);
  return result.recordset[0] || {
    mtf_daily_interest_pct: 0.05,
    mtf_total_pct_type: 'simple',
    mtf_leverage_multiplier: 2,
    effective_from: new Date().toISOString().slice(0, 10)
  };
}

async function getExecutions(pool, userId, filters) {
  const request = pool.request().input('uid', Number(userId));
  const where = ['user_id = @uid'];

  if (filters.fromDate) {
    request.input('fromDate', filters.fromDate);
    where.push('CAST(executed_at AS DATE) >= @fromDate');
  }
  if (filters.toDate) {
    request.input('toDate', filters.toDate);
    where.push('CAST(executed_at AS DATE) <= @toDate');
  }
  if (filters.symbol && String(filters.symbol).toLowerCase() !== 'all') {
    request.input('symbol', String(filters.symbol).toUpperCase());
    where.push('symbol = @symbol');
  }
  if (filters.type && String(filters.type).toLowerCase() !== 'all') {
    request.input('ptype', String(filters.type).toLowerCase() === 'mtf' ? 'mtf' : 'longterm');
    where.push('position_type = @ptype');
  }
  if (filters.source && String(filters.source).toLowerCase() !== 'all') {
    request.input('psource', String(filters.source).toLowerCase());
    where.push('trade_source = @psource');
  }

  const result = await request.query(`
    SELECT id, user_id, symbol, side, quantity, price, position_type, trade_source, charges, adjustment_factor, executed_at
    FROM dbo.executions
    WHERE ${where.join(' AND ')}
    ORDER BY executed_at ASC, id ASC
  `);
  return result.recordset || [];
}

async function getLatestLtpMap(pool, symbols, fallbackMap) {
  const map = new Map();
  if (!symbols.length) return map;

  const req = pool.request();
  const params = symbols.map((s, i) => {
    req.input(`s${i}`, s);
    return `@s${i}`;
  });

  const result = await req.query(`
    WITH t AS (
      SELECT symbol, ltp, ROW_NUMBER() OVER(PARTITION BY symbol ORDER BY as_of DESC, id DESC) AS rn
      FROM dbo.market_ticks
      WHERE symbol IN (${params.join(',')})
    )
    SELECT symbol, ltp FROM t WHERE rn = 1
  `);

  (result.recordset || []).forEach((r) => map.set(r.symbol, toNum(r.ltp)));
  symbols.forEach((s) => {
    if (!map.has(s) && fallbackMap.has(s)) map.set(s, fallbackMap.get(s));
  });
  return map;
}

function computeEngine(executions, ltpMap, mtfConfig) {
  const now = new Date();
  const positions = new Map();
  const dailyRealized = new Map();

  let totalChargesPaid = 0;
  let totalBuyValue = 0;
  let totalSellValue = 0;

  executions.forEach((row) => {
    const symbol = String(row.symbol || '').toUpperCase();
    const positionType = String(row.position_type || 'longterm').toLowerCase();
    const side = String(row.side || '').toUpperCase();
    const quantity = toNum(row.quantity);
    const price = toNum(row.price);
    const charges = toNum(row.charges);
    const source = String(row.trade_source || 'manual').toLowerCase();
    const key = `${symbol}|${positionType}`;

    if (!positions.has(key)) {
      positions.set(key, {
        symbol,
        positionType,
        quantity: 0,
        avgBuyPrice: 0,
        realizedPnl: 0,
        totalCharges: 0,
        totalBuyValue: 0,
        totalSellValue: 0,
        firstOpenDate: null,
        latestDate: row.executed_at,
        latestExecutionId: row.id,
        latestSide: side,
        latestQuantity: quantity,
        latestPrice: price,
        latestTradeSource: source,
        latestCharges: charges,
        manualQty: 0,
        algoQty: 0,
        leverageUnits: 0,
        closed: []
      });
    }

    const pos = positions.get(key);
    pos.latestDate = row.executed_at;
    pos.latestExecutionId = row.id;
    pos.latestSide = side;
    pos.latestQuantity = quantity;
    pos.latestPrice = price;
    pos.latestTradeSource = source;
    pos.latestCharges = charges;
    pos.totalCharges += charges;
    totalChargesPaid += charges;
    if (source === 'algo') pos.algoQty += quantity;
    else pos.manualQty += quantity;

    if (side === 'BUY') {
      const prevQty = pos.quantity;
      const nextQty = prevQty + quantity;
      pos.avgBuyPrice = nextQty > 0 ? ((pos.avgBuyPrice * prevQty) + (price * quantity)) / nextQty : 0;
      pos.quantity = nextQty;
      const tradeMultiplier = positionType === 'mtf' ? (toNum(row.adjustment_factor) || 1) : 1;
      pos.leverageUnits += quantity * tradeMultiplier;
      pos.totalBuyValue += price * quantity;
      totalBuyValue += price * quantity;
      if (!pos.firstOpenDate && quantity > 0) pos.firstOpenDate = row.executed_at;
      return;
    }

    if (side === 'SELL') {
      const sellQty = Math.min(quantity, pos.quantity);
      if (sellQty <= 0) return;
      const realized = ((price - pos.avgBuyPrice) * sellQty) - charges;
      pos.realizedPnl += realized;
      const avgLev = pos.quantity > 0 ? (pos.leverageUnits / pos.quantity) : 1;
      pos.leverageUnits = Math.max(0, pos.leverageUnits - (sellQty * avgLev));
      pos.quantity -= sellQty;
      pos.totalSellValue += (price * sellQty);
      totalSellValue += (price * sellQty);

      const day = String(row.executed_at).slice(0, 10);
      dailyRealized.set(day, toNum(dailyRealized.get(day)) + realized);

      if (pos.quantity === 0) {
        const holdingDays = daysBetween(pos.firstOpenDate, row.executed_at);
        pos.closed.push({
          symbol,
          position_type: positionType,
          total_buy_value: round2(pos.totalBuyValue),
          total_sell_value: round2(pos.totalSellValue),
          realized_pnl: round2(pos.realizedPnl),
          total_charges: round2(pos.totalCharges),
          holding_days: holdingDays,
          trade_source: pos.algoQty > pos.manualQty ? 'Algo' : 'Manual',
          tax_type: taxType(holdingDays),
          closed_at: row.executed_at,
          execution_id: row.id,
          execution_side: side,
          execution_quantity: sellQty,
          execution_price: price,
          execution_trade_source: source,
          execution_charges: charges,
          execution_position_type: positionType
        });

        pos.avgBuyPrice = 0;
        pos.totalBuyValue = 0;
        pos.totalSellValue = 0;
        pos.totalCharges = 0;
        pos.firstOpenDate = null;
      }
    }
  });

  const active = [];
  const closed = [];

  positions.forEach((pos) => {
    pos.closed.forEach((item) => closed.push(item));
    if (pos.quantity <= 0) return;

    const ltp = ltpMap.has(pos.symbol) ? toNum(ltpMap.get(pos.symbol)) : null;
    const daysHeld = daysBetween(pos.firstOpenDate, now);
    const principal = pos.avgBuyPrice * pos.quantity;
    const positionMultiplier = pos.positionType === 'mtf'
      ? (pos.quantity > 0 ? (pos.leverageUnits / pos.quantity) : 1)
      : 1;
    const mtfInterest = pos.positionType === 'mtf'
      ? computeInterest(principal, mtfConfig.mtf_daily_interest_pct, daysHeld, positionMultiplier, mtfConfig.mtf_total_pct_type)
      : 0;

    const effectiveCost = pos.quantity > 0
      ? (((pos.avgBuyPrice * pos.quantity) + pos.totalCharges + mtfInterest) / pos.quantity)
      : 0;

    const exposure = ltp === null ? 0 : (pos.quantity * ltp);
    const unrealized = ltp === null ? 0 : ((ltp - effectiveCost) * pos.quantity);
    const totalPnl = pos.realizedPnl + unrealized;

    const totalQty = pos.manualQty + pos.algoQty;
    const manualPct = totalQty > 0 ? (pos.manualQty * 100 / totalQty) : 0;
    const algoPct = 100 - manualPct;
    const pnlPct = effectiveCost > 0 && ltp !== null ? ((ltp - effectiveCost) * 100 / effectiveCost) : 0;

    active.push({
      symbol: pos.symbol,
      quantity: round2(pos.quantity),
      position_type: pos.positionType === 'mtf' ? 'MTF' : 'Long',
      trade_source_mix: `Manual ${round2(manualPct)}% / Algo ${round2(algoPct)}%`,
      average_buy_price: round2(pos.avgBuyPrice),
      effective_cost_per_share: round2(effectiveCost),
      current_market_price: ltp === null ? null : round2(ltp),
      exposure: round2(exposure),
      unrealized_pnl: round2(unrealized),
      realized_pnl: round2(pos.realizedPnl),
      total_pnl: round2(totalPnl),
      break_even_price: round2(effectiveCost),
      days_held: daysHeld,
      tax_classification: taxType(daysHeld),
      position_health: pnlPct > 2 ? 'Green' : (pnlPct >= -2 ? 'Yellow' : 'Red'),
      total_charges: round2(pos.totalCharges),
      total_mtf_interest: round2(mtfInterest),
      pnl_pct: round2(pnlPct),
      latest_trade_date: pos.latestDate,
      execution_id: pos.latestExecutionId,
      mtf_multiplier: round2(positionMultiplier),
      execution_side: pos.latestSide,
      execution_quantity: round2(pos.latestQuantity),
      execution_price: round2(pos.latestPrice),
      execution_trade_source: pos.latestTradeSource,
      execution_charges: round2(pos.latestCharges)
    });
  });

  const totalExposure = active.reduce((sum, r) => sum + toNum(r.exposure), 0);
  active.forEach((r) => {
    r.portfolio_allocation_pct = totalExposure > 0 ? round2((toNum(r.exposure) * 100) / totalExposure) : 0;
  });

  const totalUnrealized = active.reduce((sum, r) => sum + toNum(r.unrealized_pnl), 0);
  const totalRealized = active.reduce((sum, r) => sum + toNum(r.realized_pnl), 0) + closed.reduce((sum, r) => sum + toNum(r.realized_pnl), 0);
  const totalMtfInterest = active.reduce((sum, r) => sum + toNum(r.total_mtf_interest), 0);
  const netValue = totalExposure + totalRealized - totalChargesPaid - totalMtfInterest;
  const winCount = closed.filter((r) => toNum(r.realized_pnl) > 0).length;
  const winRate = closed.length ? (winCount * 100 / closed.length) : 0;
  const maxConcentration = active.reduce((m, r) => Math.max(m, toNum(r.portfolio_allocation_pct)), 0);

  const dayLabels = Array.from(dailyRealized.keys()).sort();
  const dailyTrend = dayLabels.map((d) => ({ date: d, pnl: round2(dailyRealized.get(d)) }));
  let eq = 0;
  const equityCurve = dailyTrend.map((r) => { eq += toNum(r.pnl); return { date: r.date, value: round2(eq) }; });

  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;
  const drawdownCurve = equityCurve.map((r) => {
    peak = Math.max(peak, toNum(r.value));
    const dd = Math.max(0, peak - toNum(r.value));
    maxDrawdown = Math.max(maxDrawdown, dd);
    return { date: r.date, value: round2(dd) };
  });

  const profitByStock = active.map((r) => ({ symbol: r.symbol, value: round2(r.total_pnl) }));
  const exposureAllocation = active.map((r) => ({ symbol: r.symbol, value: round2(r.exposure) }));
  const mtfInterest = active.filter((r) => r.position_type === 'MTF').map((r) => ({ symbol: r.symbol, value: round2(r.total_mtf_interest) }));
  const manualProfit = active.reduce((sum, r) => sum + (toNum(r.total_pnl) * 0.5), 0);
  const algoProfit = active.reduce((sum, r) => sum + toNum(r.total_pnl), 0) - manualProfit;

  const avgHolding = active.length ? (active.reduce((sum, r) => sum + toNum(r.days_held), 0) / active.length) : 0;
  const largestWin = [...profitByStock].sort((a, b) => b.value - a.value)[0] || null;
  const largestLoss = [...profitByStock].sort((a, b) => a.value - b.value)[0] || null;

  return {
    summary: {
      total_portfolio_exposure: round2(totalExposure),
      total_unrealized_pnl: round2(totalUnrealized),
      total_realized_pnl: round2(totalRealized),
      total_mtf_interest_paid: round2(totalMtfInterest),
      net_portfolio_value: round2(netValue),
      total_charges_paid: round2(totalChargesPaid),
      portfolio_concentration_pct: round2(maxConcentration),
      win_rate_pct: round2(winRate)
    },
    active_positions: active,
    closed_positions: closed,
    analytics: {
      charts: {
        profit_loss_by_stock: profitByStock,
        exposure_allocation: exposureAllocation,
        daily_pnl_trend: dailyTrend,
        cumulative_equity_curve: equityCurve,
        mtf_interest_accumulation: mtfInterest,
        algo_vs_manual_profit: [{ label: 'Algo', value: round2(algoProfit) }, { label: 'Manual', value: round2(manualProfit) }],
        win_vs_loss_ratio: [{ label: 'Win', value: winCount }, { label: 'Loss', value: Math.max(0, closed.length - winCount) }],
        holding_period_distribution: [
          { bucket: '0-7', value: active.filter((r) => r.days_held <= 7).length },
          { bucket: '8-30', value: active.filter((r) => r.days_held > 7 && r.days_held <= 30).length },
          { bucket: '31-90', value: active.filter((r) => r.days_held > 30 && r.days_held <= 90).length },
          { bucket: '90+', value: active.filter((r) => r.days_held > 90).length }
        ],
        drawdown_curve: drawdownCurve
      },
      advanced: {
        maximum_drawdown: round2(maxDrawdown),
        portfolio_concentration_pct: round2(maxConcentration),
        largest_winning_stock: largestWin,
        largest_losing_stock: largestLoss,
        average_holding_period: round2(avgHolding),
        risk_allocation_per_stock: exposureAllocation,
        sharpe_ratio_placeholder: null,
        volatility_placeholder: null
      }
    },
    totals: { total_buy_value: round2(totalBuyValue), total_sell_value: round2(totalSellValue) }
  };
}

async function syncPositions(pool, userId, activeRows) {
  await pool.request().input('uid', Number(userId)).query('DELETE FROM dbo.portfolio_positions WHERE user_id = @uid');
  for (const row of activeRows) {
    await pool.request()
      .input('uid', Number(userId))
      .input('symbol', row.symbol)
      .input('ptype', String(row.position_type).toLowerCase() === 'mtf' ? 'mtf' : 'longterm')
      .input('qty', toNum(row.quantity))
      .input('avg', toNum(row.average_buy_price))
      .input('eff', toNum(row.effective_cost_per_share))
      .input('realized', toNum(row.realized_pnl))
      .input('unrealized', toNum(row.unrealized_pnl))
      .input('charges', toNum(row.total_charges))
      .input('interest', toNum(row.total_mtf_interest))
      .query(`
        INSERT INTO dbo.portfolio_positions
        (user_id, symbol, position_type, quantity, avg_buy_price, effective_cost_per_share, realized_pnl, unrealized_pnl, total_charges, total_mtf_interest)
        VALUES (@uid, @symbol, @ptype, @qty, @avg, @eff, @realized, @unrealized, @charges, @interest)
      `);
  }
}

async function buildPortfolioForUser(userId, filters = {}) {
  const pool = await connect();
  const mtfConfig = await getActiveMtfConfig(pool);
  const executions = await getExecutions(pool, userId, filters);

  const fallbackLtp = new Map();
  executions.forEach((r) => fallbackLtp.set(String(r.symbol || '').toUpperCase(), toNum(r.price)));
  const symbols = Array.from(new Set(executions.map((r) => String(r.symbol || '').toUpperCase()).filter(Boolean)));
  const ltpMap = await getLatestLtpMap(pool, symbols, fallbackLtp);

  const result = computeEngine(executions, ltpMap, mtfConfig);
  await syncPositions(pool, userId, result.active_positions);

  return {
    ...result,
    mtf_config: {
      mtf_daily_interest_pct: toNum(mtfConfig.mtf_daily_interest_pct),
      mtf_total_pct_type: mtfConfig.mtf_total_pct_type,
      mtf_leverage_multiplier: toNum(mtfConfig.mtf_leverage_multiplier),
      effective_from: mtfConfig.effective_from
    }
  };
}

async function saveMtfConfig(userId, payload) {
  const pool = await connect();
  const daily = toNum(payload.mtf_daily_interest_pct);
  const totalType = String(payload.mtf_total_pct_type || 'simple').toLowerCase();
  const current = await getActiveMtfConfig(pool);
  const rawMultiplier = payload.mtf_leverage_multiplier;
  const multiplier = rawMultiplier === undefined || rawMultiplier === null || rawMultiplier === ''
    ? (toNum(current.mtf_leverage_multiplier) || 1)
    : (toNum(rawMultiplier) || 1);
  const effectiveFrom = payload.effective_from;

  if (!effectiveFrom) throw new Error('effective_from required');
  if (!['simple', 'compounded'].includes(totalType)) throw new Error('invalid mtf_total_pct_type');

  await pool.request().query('UPDATE dbo.charges_config SET is_active = 0 WHERE is_active = 1');
  await pool.request()
    .input('daily', daily)
    .input('totalType', totalType)
    .input('multiplier', multiplier)
    .input('effectiveFrom', effectiveFrom)
    .input('uid', Number(userId))
    .query(`
      INSERT INTO dbo.charges_config
      (mtf_daily_interest_pct, mtf_total_pct_type, mtf_leverage_multiplier, effective_from, is_active, created_by)
      VALUES (@daily, @totalType, @multiplier, @effectiveFrom, 1, @uid)
    `);

  return {
    mtf_daily_interest_pct: daily,
    mtf_total_pct_type: totalType,
    mtf_leverage_multiplier: multiplier,
    effective_from: effectiveFrom
  };
}

async function createExecutionForUser(userId, payload = {}) {
  const pool = await connect();

  const symbol = String(payload.symbol || '').trim().toUpperCase();
  const side = String(payload.side || 'BUY').trim().toUpperCase();
  const quantity = toNum(payload.quantity);
  const price = toNum(payload.price);
  const positionType = String(payload.position_type || 'mtf').trim().toLowerCase();
  const tradeSource = String(payload.trade_source || 'manual').trim().toLowerCase();
  const charges = toNum(payload.charges);
  const executedAt = payload.executed_at || null;
  const adjustmentFactor = positionType === 'mtf' ? (toNum(payload.mtf_multiplier) || 1) : null;

  if (!symbol) throw new Error('symbol required');
  if (!['BUY', 'SELL'].includes(side)) throw new Error('side must be BUY or SELL');
  if (quantity <= 0) throw new Error('quantity must be > 0');
  if (price <= 0) throw new Error('price must be > 0');
  if (!['longterm', 'mtf'].includes(positionType)) throw new Error('position_type must be longterm or mtf');
  if (!['manual', 'algo'].includes(tradeSource)) throw new Error('trade_source must be manual or algo');
  if (charges < 0) throw new Error('charges cannot be negative');
  if (positionType === 'mtf' && adjustmentFactor <= 0) throw new Error('mtf_multiplier must be > 0 for mtf');

  const inserted = await pool.request()
    .input('uid', Number(userId))
    .input('symbol', symbol)
    .input('side', side)
    .input('qty', quantity)
    .input('price', price)
    .input('ptype', positionType)
    .input('source', tradeSource)
    .input('charges', charges)
    .input('executedAt', executedAt)
    .input('adjustmentFactor', adjustmentFactor)
    .query(`
      INSERT INTO dbo.executions
      (user_id, symbol, side, quantity, price, position_type, trade_source, charges, adjustment_factor, executed_at)
      VALUES
      (@uid, @symbol, @side, @qty, @price, @ptype, @source, @charges, @adjustmentFactor, COALESCE(@executedAt, SYSUTCDATETIME()));

      SELECT TOP 1 id, user_id, symbol, side, quantity, price, position_type, trade_source, charges, adjustment_factor, executed_at
      FROM dbo.executions
      WHERE id = SCOPE_IDENTITY();
    `);

  return inserted.recordset[0] || null;
}

async function updateExecutionForUser(userId, executionId, payload = {}) {
  const pool = await connect();
  const id = Number(executionId);
  if (!id) throw new Error('invalid execution id');

  const existing = await pool.request()
    .input('id', id)
    .input('uid', Number(userId))
    .query(`
      SELECT TOP 1 id, user_id, symbol, side, quantity, price, position_type, trade_source, charges, adjustment_factor, executed_at
      FROM dbo.executions
      WHERE id = @id AND user_id = @uid
    `);
  const row = existing.recordset[0];
  if (!row) throw new Error('execution not found');

  const symbol = String(payload.symbol ?? row.symbol).trim().toUpperCase();
  const side = String(payload.side ?? row.side).trim().toUpperCase();
  const quantity = toNum(payload.quantity ?? row.quantity);
  const price = toNum(payload.price ?? row.price);
  const positionType = String(payload.position_type ?? row.position_type).trim().toLowerCase();
  const tradeSource = String(payload.trade_source ?? row.trade_source).trim().toLowerCase();
  const charges = toNum(payload.charges ?? row.charges);
  const executedAt = payload.executed_at ?? row.executed_at;
  const adjustmentFactor = positionType === 'mtf'
    ? (toNum(payload.mtf_multiplier ?? row.adjustment_factor) || 1)
    : null;

  if (!symbol) throw new Error('symbol required');
  if (!['BUY', 'SELL'].includes(side)) throw new Error('side must be BUY or SELL');
  if (quantity <= 0) throw new Error('quantity must be > 0');
  if (price <= 0) throw new Error('price must be > 0');
  if (!['longterm', 'mtf'].includes(positionType)) throw new Error('position_type must be longterm or mtf');
  if (!['manual', 'algo'].includes(tradeSource)) throw new Error('trade_source must be manual or algo');
  if (charges < 0) throw new Error('charges cannot be negative');
  if (positionType === 'mtf' && adjustmentFactor <= 0) throw new Error('mtf_multiplier must be > 0 for mtf');

  const updated = await pool.request()
    .input('id', id)
    .input('uid', Number(userId))
    .input('symbol', symbol)
    .input('side', side)
    .input('qty', quantity)
    .input('price', price)
    .input('ptype', positionType)
    .input('source', tradeSource)
    .input('charges', charges)
    .input('adjustmentFactor', adjustmentFactor)
    .input('executedAt', executedAt)
    .query(`
      UPDATE dbo.executions
      SET symbol = @symbol,
          side = @side,
          quantity = @qty,
          price = @price,
          position_type = @ptype,
          trade_source = @source,
          charges = @charges,
          adjustment_factor = @adjustmentFactor,
          executed_at = @executedAt
      WHERE id = @id AND user_id = @uid;

      SELECT TOP 1 id, user_id, symbol, side, quantity, price, position_type, trade_source, charges, adjustment_factor, executed_at
      FROM dbo.executions
      WHERE id = @id AND user_id = @uid;
    `);

  return updated.recordset[0] || null;
}

function toCsvRows(portfolio) {
  const rows = [];
  rows.push('Section,Symbol,PositionType,Quantity,Exposure,UnrealizedPNL,RealizedPNL,TotalPNL,Charges,MTFInterest');
  (portfolio.active_positions || []).forEach((r) => {
    rows.push(['ACTIVE', r.symbol, r.position_type, r.quantity, r.exposure, r.unrealized_pnl, r.realized_pnl, r.total_pnl, r.total_charges, r.total_mtf_interest].join(','));
  });
  (portfolio.closed_positions || []).forEach((r) => {
    rows.push(['CLOSED', r.symbol, r.position_type || '', '', '', '', r.realized_pnl, r.realized_pnl, r.total_charges, ''].join(','));
  });
  return rows.join('\n');
}

module.exports = {
  buildPortfolioForUser,
  saveMtfConfig,
  createExecutionForUser,
  updateExecutionForUser,
  toCsvRows
};
