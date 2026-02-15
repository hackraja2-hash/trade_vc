function parseJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join('')
    );
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function getCurrentUserType() {
  const token = localStorage.getItem('smarttrade_token');
  const payload = parseJwtPayload(token);
  return (payload && payload.user_type ? String(payload.user_type) : localStorage.getItem('smarttrade_user_type') || 'normal').toLowerCase();
}

function getCurrentUsername() {
  const token = localStorage.getItem('smarttrade_token');
  const payload = parseJwtPayload(token);
  return (payload && payload.username) || localStorage.getItem('smarttrade_user') || 'user';
}

function getStoredModuleAccess() {
  try {
    return JSON.parse(localStorage.getItem('smarttrade_module_access') || '{}');
  } catch (_) {
    return {};
  }
}

function getModuleFromPath(pathname) {
  const path = String(pathname || '').toLowerCase();
  if (path.endsWith('dashboard.html') || path.endsWith('/dashboard.html')) return 'dashboard';
  if (path.endsWith('buy-strategy.html') || path.endsWith('/buy-strategy.html')) return 'strategyBuilder';
  if (path.endsWith('sell-strategy.html') || path.endsWith('/sell-strategy.html')) return 'strategyBuilder';
  if (path.endsWith('nse-bse.html') || path.endsWith('/nse-bse.html')) return 'tradeExecution';
  if (path.endsWith('portfolio.html') || path.endsWith('/portfolio.html')) return 'reports';
  return null;
}

function hideLink(link) {
  if (!link) return;
  if (link.parentElement) link.parentElement.style.display = 'none';
  else link.style.display = 'none';
}

function firstAllowedPage(modules) {
  const candidates = [
    { page: 'dashboard.html', module: 'dashboard' },
    { page: 'buy-strategy.html', module: 'strategyBuilder' },
    { page: 'sell-strategy.html', module: 'strategyBuilder' },
    { page: 'nse-bse.html', module: 'tradeExecution' },
    { page: 'portfolio.html', module: 'reports' }
  ];
  const allowed = candidates.find((item) => modules[item.module]);
  return allowed ? allowed.page : 'login.html';
}

function applyMenuAccessControl() {
  const userType = getCurrentUserType();
  const modules = getStoredModuleAccess();
  const roleLinks = document.querySelectorAll('[data-role-link]');
  roleLinks.forEach((link) => {
    const required = (link.getAttribute('data-role-link') || '').toLowerCase();
    if (required === 'superadmin' && userType !== 'superadmin') {
      hideLink(link);
    }
    if (required === 'admin' && userType === 'normal') {
      hideLink(link);
    }
  });

  const adminAnchors = document.querySelectorAll('a[href="admin.html"]');
  const superAdminAnchors = document.querySelectorAll('a[href="superadmin.html"]');
  if (userType === 'normal') {
    adminAnchors.forEach((link) => hideLink(link));
    superAdminAnchors.forEach((link) => hideLink(link));
  }
  if (userType === 'admin') {
    superAdminAnchors.forEach((link) => hideLink(link));
  }

  if (userType === 'normal') {
    document.querySelectorAll('a[href]').forEach((link) => {
      const href = (link.getAttribute('href') || '').toLowerCase();
      const module = getModuleFromPath(href);
      if (module && !modules[module]) hideLink(link);
    });
  }

  const path = window.location.pathname.toLowerCase();
  const requiredModule = getModuleFromPath(path);
  if (path.endsWith('/admin.html') || path.endsWith('admin.html')) {
    if (userType !== 'admin' && userType !== 'superadmin') window.location.href = 'dashboard.html';
  }
  if (path.endsWith('/superadmin.html') || path.endsWith('superadmin.html')) {
    if (userType !== 'superadmin') window.location.href = 'dashboard.html';
  }
  if (userType === 'normal' && requiredModule && !modules[requiredModule]) {
    window.location.href = firstAllowedPage(modules);
  }
}

async function refreshCurrentUserContext() {
  const token = localStorage.getItem('smarttrade_token');
  if (!token) return;
  try {
    const response = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return;
    const data = await response.json();
    const user = data && data.user ? data.user : null;
    if (!user) return;
    localStorage.setItem('smarttrade_user', user.username || getCurrentUsername());
    localStorage.setItem('smarttrade_user_type', String(user.user_type || getCurrentUserType()).toLowerCase());
    localStorage.setItem('smarttrade_module_access', JSON.stringify(user.module_access || {}));
  } catch (_) {
    // no-op
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const logoutBtn = document.getElementById('logoutBtn');

  await refreshCurrentUserContext();

  const userLabelEls = document.querySelectorAll('#userLabel, #heroUser');
  const currentUser = getCurrentUsername();
  userLabelEls.forEach((element) => {
    if (element) element.textContent = currentUser;
  });

  applyMenuAccessControl();

  async function backendLogin(username, password) {
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (!response.ok) return { ok: false, status: response.status, body: await response.json().catch(() => null) };
      const data = await response.json();
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async function backendRegister(username, password, fullname) {
    try {
      const email = document.getElementById('regEmail') ? document.getElementById('regEmail').value.trim() : null;
      const phone = document.getElementById('regPhone') ? document.getElementById('regPhone').value.trim() : null;
      const address = document.getElementById('regAddress') ? document.getElementById('regAddress').value.trim() : null;
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, fullname, email, phone, address })
      });
      if (!response.ok) return { ok: false, status: response.status, body: await response.json().catch(() => null) };
      const data = await response.json();
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error };
    }
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = (document.getElementById('username') || {}).value || '';
      const password = (document.getElementById('password') || {}).value || '';
      const msg = document.getElementById('loginMsg');

      if (!username || !password) {
        if (msg) msg.textContent = 'Enter username and password';
        return;
      }

      if (msg) msg.textContent = 'Signing in…';

      const result = await backendLogin(username, password);
      if (result.ok && result.data && result.data.token) {
        localStorage.setItem('smarttrade_token', result.data.token);
        localStorage.setItem('smarttrade_user', result.data.username || username);
        localStorage.setItem('smarttrade_user_type', (result.data.user_type || 'normal').toLowerCase());
        await refreshCurrentUserContext();
        window.location.href = 'dashboard.html';
        return;
      }

      if (msg) msg.textContent = 'Invalid credentials or server error';
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = (document.getElementById('regUsername') || {}).value || '';
      const password = (document.getElementById('regPassword') || {}).value || '';
      const fullname = (document.getElementById('fullname') || {}).value || '';
      const result = await backendRegister(username, password, fullname);
      if (result.ok && result.data) {
        alert('Registration successful. Please login.');
        window.location.href = 'login.html';
        return;
      }

      alert('Registration failed');
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('smarttrade_user');
      localStorage.removeItem('smarttrade_user_type');
      localStorage.removeItem('smarttrade_token');
      localStorage.removeItem('smarttrade_module_access');
      window.location.href = 'login.html';
    });
  }
});

async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem('smarttrade_token');
  const headers = opts.headers || {};
  if (token) headers.Authorization = `Bearer ${token}`;
  opts.headers = Object.assign({ 'Content-Type': 'application/json' }, headers);
  return fetch(path, opts);
}

(function initializeSmartTradeChartCatalog() {
  const CATEGORY_BASE_TYPES = {
    '2d': [
      'line','spline','step','area','stacked_area','bar','grouped_bar','stacked_bar','horizontal_bar',
      'scatter','bubble','dot','lollipop','radar','polar','pie','donut','rose','sunburst_like','treemap_like',
      'waterfall_like','funnel_like','histogram','box','violin','ridgeline_like','density_like',
      'line_closing_price','range_bar','tick_chart','point_figure','three_line_break','dumbbell_chart',
      'bullet_graph','parallel_coordinates','gauge_chart','calendar_plot','highlight_table','clustered_column',
      'stacked_column','combo_chart','span_chart','pictogram_chart','radial_bar','timeline_chart',
      'nightingale_rose','proportional_area','radial_column','word_cloud','gantt_chart','venn_diagram',
      'population_pyramid','arc_diagram','wedge_stack','streamgraph','flow_map','bubble_map'
    ],
    '3d': [
      'surface3d','mesh3d','scatter3d','line3d','bar3d','spiral3d','wireframe3d_like','contour3d_like',
      'terrain3d_like','cluster3d_like','vector3d_like','cone3d_like','break_even_surface3d',
      'monte_carlo_surface3d','volatility_smile3d','efficient_frontier3d','scenario_cube3d'
    ],
    'stock': [
      'candlestick_like','ohlc_like','heikin_ashi_like','renko_like','kagi_like','line_break_like',
      'volume_combo','vwap_like','rsi_like','macd_like','stochastic_like','bollinger_like','atr_like',
      'adx_like','ichimoku_like','pivot_points_like','support_resistance_like','market_profile_like',
      'orderbook_depth_like','correlation_matrix','pair_spread_like','rolling_beta_like','sma_overlay',
      'ema_overlay','mfi_like','fibonacci_retracement_like','parabolic_sar_like','roc_like','cci_like',
      'obv_like','donchian_channel_like','detrended_price_oscillator_like','force_index_like',
      'head_shoulders','double_top','double_bottom','ascending_triangle','descending_triangle',
      'symmetrical_triangle','flag_pattern','pennant_pattern','cup_handle','rounding_bottom',
      'wedge_pattern','triple_top_bottom','rectangle_pattern','gap_pattern','bullish_engulfing',
      'bearish_engulfing','doji_pattern','hammer_pattern','shooting_star_pattern','trendline_channel',
      'market_breadth_ad_line','valuation_football_field','stock_correlation_network','company_structure_tree'
    ],
    'heatmap': [
      'heatmap','contour','cluster_heatmap_like','decision_heatmap','calendar_heatmap_like',
      'risk_heatmap_like','correlation_heatmap_like','treemap_heat_like','regional_performance_heatmap',
      'highlight_matrix','calendar_return_heatmap','correlation_matrix_heatmap','volatility_heatmap',
      'asset_interdependency_matrix'
    ],
    'decision': [
      'whatif_tree','scenario_fan','sensitivity_tornado','break_even_surface','position_sizing_matrix',
      'stoploss_takeprofit_map','monte_carlo_like','risk_return_frontier','probability_cone_like',
      'regime_switch_like','allocation_optimizer_like','drawdown_recovery_like','value_at_risk_histogram',
      'drawdown_curve','drawdown_duration_chart','error_bars_confidence','qq_plot_returns',
      'moving_volatility_line','beta_coefficient_scatter','sankey_cashflow','chord_asset_flow',
      'force_directed_correlation','density_plot_returns','violin_distribution_spread','network_holdings',
      'capital_flow_sankey','asset_turnover_path','investment_strategy_venn','budget_target_gauge',
      'networth_growth_area','return_distribution_histogram','portfolio_health_radar','performance_benchmark_bullet'
    ]
  };

  const STYLE_VARIANTS = ['classic', 'pro', 'institutional'];

  function toLabel(value) {
    return String(value || '')
      .replaceAll('_', ' ')
      .replace(/\blike\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function createCatalog() {
    const catalog = {};
    Object.entries(CATEGORY_BASE_TYPES).forEach(([category, baseTypes]) => {
      const rows = [];
      baseTypes.forEach((base) => {
        STYLE_VARIANTS.forEach((variant) => {
          const value = `${base}__${variant}`;
          rows.push({
            value,
            base,
            variant,
            category,
            label: `${toLabel(base)} (${toLabel(variant)})`
          });
        });
      });
      catalog[category] = rows;
    });
    return catalog;
  }

  const MODERN_GRAPH_CATALOG = createCatalog();

  function flattenCatalog() {
    return Object.values(MODERN_GRAPH_CATALOG).flat();
  }

  function getModernGraphCatalog() {
    return MODERN_GRAPH_CATALOG;
  }

  function getModernGraphTypesForCategory(category) {
    return MODERN_GRAPH_CATALOG[category] || MODERN_GRAPH_CATALOG['2d'] || [];
  }

  function parseModernGraphType(typeValue) {
    const raw = String(typeValue || 'line');
    const [base, variant] = raw.split('__');
    return {
      raw,
      base: base || 'line',
      variant: variant || 'classic'
    };
  }

  function getModernGraphStats() {
    const total = flattenCatalog().length;
    return {
      total,
      categories: Object.keys(MODERN_GRAPH_CATALOG),
      variants: [...STYLE_VARIANTS]
    };
  }

  function sma(values, period) {
    const p = Math.max(1, Number(period || 1));
    return values.map((_, index) => {
      const start = Math.max(0, index - p + 1);
      const slice = values.slice(start, index + 1);
      const sum = slice.reduce((acc, item) => acc + Number(item || 0), 0);
      return sum / slice.length;
    });
  }

  function ema(values, period) {
    const p = Math.max(1, Number(period || 1));
    const k = 2 / (p + 1);
    const out = [];
    values.forEach((value, index) => {
      const current = Number(value || 0);
      if (index === 0) out.push(current);
      else out.push((current * k) + (out[index - 1] * (1 - k)));
    });
    return out;
  }

  function rsi(values, period = 14) {
    if (!values.length) return [];
    const p = Math.max(2, Number(period || 14));
    const gains = [0];
    const losses = [0];
    for (let i = 1; i < values.length; i += 1) {
      const diff = Number(values[i] || 0) - Number(values[i - 1] || 0);
      gains.push(Math.max(0, diff));
      losses.push(Math.max(0, -diff));
    }
    const avgGain = sma(gains, p);
    const avgLoss = sma(losses, p);
    return avgGain.map((g, i) => {
      const l = avgLoss[i] || 0.000001;
      const rs = g / l;
      return 100 - (100 / (1 + rs));
    });
  }

  function renderFinancialPlotly(config) {
    try {
      const {
        plotlyEl,
        baseType,
        variant,
        labels,
        values,
        depth,
        color,
        title
      } = config || {};
      if (!plotlyEl || !window.Plotly) return false;

      const x = Array.isArray(labels) && labels.length ? labels : ['No Data'];
      const y = (Array.isArray(values) && values.length ? values : [0]).map((v) => Number(v || 0));
      const z = (Array.isArray(depth) && depth.length ? depth : y).map((v, i) => Math.abs(Number(v || 0)) + (i + 1));
      const idx = x.map((_, i) => i + 1);
      const absY = y.map((v) => Math.abs(v));
      const mainColor = color || '#4f46e5';
      const lineWidth = variant === 'institutional' ? 4 : variant === 'pro' ? 3 : 2;
      const markerSize = variant === 'institutional' ? 8 : variant === 'pro' ? 7 : 6;
      const opacity = variant === 'institutional' ? 0.92 : variant === 'pro' ? 0.84 : 0.75;

      let data = [];
      const layout = {
        title: { text: title || toLabel(baseType), font: { size: 16 } },
        margin: { l: 56, r: 20, t: 56, b: 56 },
        paper_bgcolor: '#ffffff',
        plot_bgcolor: '#ffffff',
        font: { size: 13, color: '#0f172a' },
        xaxis: { tickfont: { size: 12 }, automargin: true },
        yaxis: { tickfont: { size: 12 }, automargin: true }
      };

      const handled = new Set([
        'candlestick_like','ohlc_like','heikin_ashi_like','renko_like','kagi_like','line_break_like',
        'sma_overlay','ema_overlay','bollinger_like','macd_like','rsi_like','stochastic_like',
        'volume_combo','vwap_like','atr_like','mfi_like','fibonacci_retracement_like','ichimoku_like',
        'parabolic_sar_like','roc_like','cci_like','obv_like','donchian_channel_like','force_index_like',
        'value_at_risk_histogram','monte_carlo_like','drawdown_curve','drawdown_duration_chart',
        'risk_return_frontier','whatif_tree','scenario_fan','sensitivity_tornado','break_even_surface'
      ]);

      if (!handled.has(baseType)) return false;

      const ema12 = ema(y, 12);
      const ema26 = ema(y, 26);
      const macd = ema12.map((v, i) => v - ema26[i]);
      const signal = ema(macd, 9);

      switch (baseType) {
        case 'candlestick_like':
          data = [{ type: 'candlestick', x, open: y.map((v) => v * 0.97), high: y.map((v) => v * 1.05), low: y.map((v) => v * 0.94), close: y }];
          break;
        case 'ohlc_like':
          data = [{ type: 'ohlc', x, open: y.map((v) => v * 0.98), high: y.map((v) => v * 1.04), low: y.map((v) => v * 0.95), close: y }];
          break;
        case 'heikin_ashi_like': {
          const open = y.map((v, i) => (i === 0 ? v : (y[i - 1] + v) / 2));
          const close = y.map((v, i) => (v + open[i]) / 2);
          const high = y.map((v, i) => Math.max(v, open[i], close[i]));
          const low = y.map((v, i) => Math.min(v, open[i], close[i]));
          data = [{ type: 'candlestick', x, open, high, low, close }];
          break;
        }
        case 'renko_like':
          data = [{ type: 'bar', x, y: y.map((v, i) => (i === 0 ? 0 : v - y[i - 1])), marker: { color: y.map((v, i) => (i > 0 && v >= y[i - 1] ? '#16a34a' : '#dc2626')) } }];
          break;
        case 'kagi_like':
        case 'line_break_like':
          data = [{ type: 'scatter', x, y, mode: 'lines', line: { color: mainColor, width: lineWidth, shape: 'hv' } }];
          break;
        case 'sma_overlay':
          data = [
            { type: 'scatter', x, y, mode: 'lines', name: 'Price', line: { color: mainColor, width: lineWidth + 1 } },
            { type: 'scatter', x, y: sma(y, 14), mode: 'lines', name: 'SMA 14', line: { color: '#06b6d4', width: lineWidth } },
            { type: 'scatter', x, y: sma(y, 50), mode: 'lines', name: 'SMA 50', line: { color: '#f59e0b', width: lineWidth } }
          ];
          break;
        case 'ema_overlay':
          data = [
            { type: 'scatter', x, y, mode: 'lines', name: 'Price', line: { color: mainColor, width: lineWidth + 1 } },
            { type: 'scatter', x, y: ema(y, 12), mode: 'lines', name: 'EMA 12', line: { color: '#22c55e', width: lineWidth } },
            { type: 'scatter', x, y: ema(y, 26), mode: 'lines', name: 'EMA 26', line: { color: '#ef4444', width: lineWidth } }
          ];
          break;
        case 'bollinger_like': {
          const mid = sma(y, 20);
          const std = y.map((_, i) => {
            const start = Math.max(0, i - 19);
            const s = y.slice(start, i + 1);
            const mean = s.reduce((a, b) => a + b, 0) / s.length;
            const variance = s.reduce((a, b) => a + ((b - mean) ** 2), 0) / s.length;
            return Math.sqrt(variance);
          });
          const upper = mid.map((m, i) => m + (2 * std[i]));
          const lower = mid.map((m, i) => m - (2 * std[i]));
          data = [
            { type: 'scatter', x, y, mode: 'lines', name: 'Price', line: { color: mainColor, width: lineWidth } },
            { type: 'scatter', x, y: upper, mode: 'lines', name: 'Upper', line: { color: '#22c55e', width: 1 } },
            { type: 'scatter', x, y: lower, mode: 'lines', name: 'Lower', line: { color: '#ef4444', width: 1 }, fill: 'tonexty', fillcolor: 'rgba(99,102,241,0.08)' }
          ];
          break;
        }
        case 'macd_like':
          data = [
            { type: 'scatter', x, y: macd, mode: 'lines', name: 'MACD', line: { color: mainColor, width: lineWidth + 1 } },
            { type: 'scatter', x, y: signal, mode: 'lines', name: 'Signal', line: { color: '#f59e0b', width: lineWidth } },
            { type: 'bar', x, y: macd.map((v, i) => v - signal[i]), name: 'Histogram', marker: { color: '#22c55e' }, opacity: 0.55 }
          ];
          break;
        case 'rsi_like':
          data = [{ type: 'scatter', x, y: rsi(y, 14), mode: 'lines', line: { color: mainColor, width: lineWidth + 1 } }];
          layout.yaxis = { title: 'RSI', range: [0, 100] };
          break;
        case 'stochastic_like': {
          const low14 = y.map((_, i) => Math.min(...y.slice(Math.max(0, i - 13), i + 1)));
          const high14 = y.map((_, i) => Math.max(...y.slice(Math.max(0, i - 13), i + 1)));
          const k = y.map((v, i) => ((v - low14[i]) / Math.max(0.00001, high14[i] - low14[i])) * 100);
          const d = sma(k, 3);
          data = [
            { type: 'scatter', x, y: k, mode: 'lines', name: '%K', line: { color: mainColor, width: lineWidth + 1 } },
            { type: 'scatter', x, y: d, mode: 'lines', name: '%D', line: { color: '#f59e0b', width: lineWidth } }
          ];
          layout.yaxis = { title: 'Stochastic', range: [0, 100] };
          break;
        }
        case 'volume_combo':
          data = [
            { type: 'bar', x, y: absY.map((v) => Math.max(1, Math.round(v * 8))), name: 'Volume', marker: { color: '#06b6d4' } },
            { type: 'scatter', x, y, mode: 'lines+markers', name: 'Price', line: { color: mainColor, width: lineWidth + 1 }, yaxis: 'y2' }
          ];
          layout.yaxis = { title: 'Volume' };
          layout.yaxis2 = { title: 'Price', overlaying: 'y', side: 'right' };
          break;
        case 'vwap_like': {
          const cumV = absY.reduce((arr, v, i) => { arr.push((arr[i - 1] || 0) + v); return arr; }, []);
          const cumPV = y.reduce((arr, v, i) => { arr.push((arr[i - 1] || 0) + (v * absY[i])); return arr; }, []);
          const vwap = cumPV.map((v, i) => v / Math.max(1, cumV[i]));
          data = [
            { type: 'scatter', x, y, mode: 'lines', name: 'Price', line: { color: mainColor, width: lineWidth + 1 } },
            { type: 'scatter', x, y: vwap, mode: 'lines', name: 'VWAP', line: { color: '#10b981', width: lineWidth } }
          ];
          break;
        }
        case 'atr_like': {
          const tr = y.map((v, i) => i === 0 ? 0 : Math.abs(v - y[i - 1]));
          data = [{ type: 'scatter', x, y: sma(tr, 14), mode: 'lines', line: { color: mainColor, width: lineWidth + 1 } }];
          break;
        }
        case 'mfi_like': {
          const moneyFlow = y.map((v, i) => v * Math.max(1, absY[i]));
          data = [{ type: 'scatter', x, y: rsi(moneyFlow, 14), mode: 'lines', line: { color: mainColor, width: lineWidth + 1 } }];
          layout.yaxis = { title: 'MFI', range: [0, 100] };
          break;
        }
        case 'fibonacci_retracement_like': {
          const high = Math.max(...y);
          const low = Math.min(...y);
          const levels = [0.236, 0.382, 0.5, 0.618, 0.786].map((lv) => high - ((high - low) * lv));
          data = [{ type: 'scatter', x, y, mode: 'lines', line: { color: mainColor, width: lineWidth + 1 } }];
          layout.shapes = levels.map((lv) => ({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: lv, y1: lv, line: { color: '#64748b', dash: 'dot', width: 1 } }));
          break;
        }
        case 'ichimoku_like': {
          const tenkan = sma(y, 9);
          const kijun = sma(y, 26);
          const spanA = tenkan.map((v, i) => (v + kijun[i]) / 2);
          const spanB = sma(y, 52);
          data = [
            { type: 'scatter', x, y, mode: 'lines', name: 'Price', line: { color: mainColor, width: lineWidth + 1 } },
            { type: 'scatter', x, y: tenkan, mode: 'lines', name: 'Tenkan', line: { color: '#22c55e', width: lineWidth } },
            { type: 'scatter', x, y: kijun, mode: 'lines', name: 'Kijun', line: { color: '#f59e0b', width: lineWidth } },
            { type: 'scatter', x, y: spanA, mode: 'lines', name: 'Span A', line: { color: '#06b6d4', width: 1 } },
            { type: 'scatter', x, y: spanB, mode: 'lines', name: 'Span B', line: { color: '#ef4444', width: 1 }, fill: 'tonexty', fillcolor: 'rgba(148,163,184,0.14)' }
          ];
          break;
        }
        case 'parabolic_sar_like': {
          const sar = y.map((v, i) => v + ((i % 2 === 0 ? -1 : 1) * Math.abs(v) * 0.015));
          data = [
            { type: 'scatter', x, y, mode: 'lines', name: 'Price', line: { color: mainColor, width: lineWidth + 1 } },
            { type: 'scatter', x, y: sar, mode: 'markers', name: 'SAR', marker: { color: '#ef4444', size: markerSize } }
          ];
          break;
        }
        case 'roc_like':
          data = [{ type: 'scatter', x, y: y.map((v, i) => i === 0 ? 0 : ((v - y[i - 1]) / Math.max(0.00001, y[i - 1])) * 100), mode: 'lines', line: { color: mainColor, width: lineWidth + 1 } }];
          break;
        case 'cci_like': {
          const mean = sma(y, 20);
          const md = y.map((v, i) => Math.abs(v - mean[i]));
          const cci = y.map((v, i) => (v - mean[i]) / Math.max(0.00001, 0.015 * (md[i] || 1)));
          data = [{ type: 'scatter', x, y: cci, mode: 'lines', line: { color: mainColor, width: lineWidth + 1 } }];
          break;
        }
        case 'obv_like': {
          const obv = [];
          y.forEach((v, i) => {
            if (i === 0) obv.push(absY[i]);
            else obv.push((obv[i - 1] || 0) + (v >= y[i - 1] ? absY[i] : -absY[i]));
          });
          data = [{ type: 'scatter', x, y: obv, mode: 'lines', line: { color: mainColor, width: lineWidth + 1 } }];
          break;
        }
        case 'donchian_channel_like': {
          const upper = y.map((_, i) => Math.max(...y.slice(Math.max(0, i - 19), i + 1)));
          const lower = y.map((_, i) => Math.min(...y.slice(Math.max(0, i - 19), i + 1)));
          data = [
            { type: 'scatter', x, y, mode: 'lines', name: 'Price', line: { color: mainColor, width: lineWidth + 1 } },
            { type: 'scatter', x, y: upper, mode: 'lines', name: 'Upper', line: { color: '#22c55e', width: 1 } },
            { type: 'scatter', x, y: lower, mode: 'lines', name: 'Lower', line: { color: '#ef4444', width: 1 }, fill: 'tonexty', fillcolor: 'rgba(148,163,184,0.10)' }
          ];
          break;
        }
        case 'force_index_like':
          data = [{ type: 'bar', x, y: y.map((v, i) => i === 0 ? 0 : (v - y[i - 1]) * absY[i]), marker: { color: mainColor }, opacity }];
          break;
        case 'value_at_risk_histogram': {
          const returns = y.map((v, i) => i === 0 ? 0 : ((v - y[i - 1]) / Math.max(0.00001, y[i - 1])));
          data = [{ type: 'histogram', x: returns, marker: { color: mainColor } }];
          layout.xaxis.title = 'Return';
          layout.yaxis.title = 'Frequency';
          break;
        }
        case 'drawdown_curve': {
          let peak = y[0] || 0;
          const dd = y.map((v) => {
            peak = Math.max(peak, v);
            return ((v - peak) / Math.max(0.00001, peak)) * 100;
          });
          data = [{ type: 'scatter', x, y: dd, mode: 'lines', line: { color: '#dc2626', width: lineWidth + 1 }, fill: 'tozeroy', fillcolor: 'rgba(239,68,68,0.14)' }];
          layout.yaxis.title = 'Drawdown %';
          break;
        }
        case 'drawdown_duration_chart': {
          let peak = y[0] || 0;
          let duration = 0;
          const series = y.map((v) => {
            if (v >= peak) {
              peak = v;
              duration = 0;
            } else {
              duration += 1;
            }
            return duration;
          });
          data = [{ type: 'bar', x, y: series, marker: { color: '#b91c1c' } }];
          layout.yaxis.title = 'Duration';
          break;
        }
        case 'monte_carlo_like':
          data = Array.from({ length: 16 }, (_, s) => ({
            type: 'scatter',
            mode: 'lines',
            x,
            y: y.map((v, i) => v + ((s - 8) * 0.7) + (Math.sin(i + s) * 1.1)),
            line: { width: 1, color: `rgba(79,70,229,${0.12 + (s * 0.03)})` },
            showlegend: false
          }));
          break;
        case 'risk_return_frontier':
          data = [{ type: 'scatter', mode: 'markers+lines', x: z, y, marker: { size: markerSize + 2, color: y, colorscale: 'RdYlGn' }, line: { color: mainColor, width: lineWidth }, text: x }];
          layout.xaxis.title = 'Risk';
          layout.yaxis.title = 'Expected Return';
          break;
        case 'whatif_tree':
          data = [{ type: 'treemap', labels: ['Base', ...x], parents: ['', ...x.map(() => 'Base')], values: [absY.reduce((a, b) => a + b, 0), ...absY], marker: { colorscale: 'Blues' } }];
          break;
        case 'scenario_fan': {
          const optimistic = y.map((v, i) => v + ((i + 1) * 0.8));
          const pessimistic = y.map((v, i) => v - ((i + 1) * 0.8));
          data = [
            { type: 'scatter', x, y: optimistic, mode: 'lines', name: 'Optimistic', line: { color: '#16a34a', width: lineWidth } },
            { type: 'scatter', x, y, mode: 'lines', name: 'Base', line: { color: mainColor, width: lineWidth + 1 } },
            { type: 'scatter', x, y: pessimistic, mode: 'lines', name: 'Pessimistic', line: { color: '#dc2626', width: lineWidth } }
          ];
          break;
        }
        case 'sensitivity_tornado':
          data = [{ type: 'bar', y: x, x: absY, orientation: 'h', marker: { color: mainColor }, opacity }];
          break;
        case 'break_even_surface':
          data = [{ type: 'surface', z: [y, z, y.map((v, i) => (v + z[i]) / 2)], colorscale: 'Electric' }];
          layout.scene = { xaxis: { title: 'Risk' }, yaxis: { title: 'Return' }, zaxis: { title: 'Break-even' } };
          break;
        default:
          return false;
      }

      Plotly.newPlot(plotlyEl, data, layout, { responsive: true, displayModeBar: true });
      return true;
    } catch (_) {
      return false;
    }
  }

  window.SmartTradeCharts = Object.assign({}, window.SmartTradeCharts || {}, {
    getModernGraphCatalog,
    getModernGraphTypesForCategory,
    parseModernGraphType,
    getModernGraphStats,
    renderFinancialPlotly
  });
})();
