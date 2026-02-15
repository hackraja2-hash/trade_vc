const express = require('express');
const { auth } = require('../middleware/auth');
const { getPortfolio, setMtfConfig, getAnalytics, exportPortfolio, createExecution, updateExecution } = require('../controllers/portfolioController');

const router = express.Router();

router.get('/', auth, getPortfolio);
router.post('/mtf-config', auth, setMtfConfig);
router.post('/executions', auth, createExecution);
router.patch('/executions/:id', auth, updateExecution);
router.get('/analytics', auth, getAnalytics);
router.get('/export', auth, exportPortfolio);

module.exports = router;
