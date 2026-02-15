const { buildPortfolioForUser, saveMtfConfig, createExecutionForUser, updateExecutionForUser, toCsvRows } = require('../services/portfolioEngineService');

function sendError(res, code, msg) {
  return res.status(code).json({ error: msg });
}

async function getPortfolio(req, res) {
  try {
    const filters = {
      fromDate: req.query.fromDate || null,
      toDate: req.query.toDate || null,
      symbol: req.query.symbol || null,
      type: req.query.type || null,
      source: req.query.source || null
    };
    const portfolio = await buildPortfolioForUser(req.user.id, filters);
    return res.json(portfolio);
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'failed to load portfolio');
  }
}

async function setMtfConfig(req, res) {
  try {
    const saved = await saveMtfConfig(req.user.id, req.body || {});
    const portfolio = await buildPortfolioForUser(req.user.id, {});
    return res.json({ success: true, mtf_config: saved, preview: portfolio.mtf_config });
  } catch (error) {
    console.error(error);
    return sendError(res, 400, error.message || 'failed to save mtf config');
  }
}

async function getAnalytics(req, res) {
  try {
    const filters = {
      fromDate: req.query.fromDate || null,
      toDate: req.query.toDate || null,
      symbol: req.query.symbol || null,
      type: req.query.type || null,
      source: req.query.source || null
    };
    const portfolio = await buildPortfolioForUser(req.user.id, filters);
    return res.json({
      summary: portfolio.summary,
      analytics: portfolio.analytics,
      mtf_config: portfolio.mtf_config
    });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'failed to load analytics');
  }
}

async function exportPortfolio(req, res) {
  try {
    const type = String(req.query.type || 'excel').toLowerCase();
    const portfolio = await buildPortfolioForUser(req.user.id, {});
    const csv = toCsvRows(portfolio);

    if (type === 'excel') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="portfolio-export.csv"');
      return res.send(csv);
    }

    if (type === 'pdf') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename="portfolio-export.txt"');
      return res.send(csv);
    }

    return sendError(res, 400, 'unsupported export type');
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'failed to export portfolio');
  }
}

async function createExecution(req, res) {
  try {
    const execution = await createExecutionForUser(req.user.id, req.body || {});
    const portfolio = await buildPortfolioForUser(req.user.id, {});
    return res.json({ success: true, execution, mtf_config: portfolio.mtf_config });
  } catch (error) {
    console.error(error);
    return sendError(res, 400, error.message || 'failed to create execution');
  }
}

async function updateExecution(req, res) {
  try {
    const execution = await updateExecutionForUser(req.user.id, req.params.id, req.body || {});
    const portfolio = await buildPortfolioForUser(req.user.id, {});
    return res.json({ success: true, execution, mtf_config: portfolio.mtf_config });
  } catch (error) {
    console.error(error);
    return sendError(res, 400, error.message || 'failed to update execution');
  }
}

module.exports = {
  getPortfolio,
  setMtfConfig,
  getAnalytics,
  exportPortfolio,
  createExecution,
  updateExecution
};
