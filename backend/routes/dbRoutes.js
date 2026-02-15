const express = require('express');
const { auth, requireUserType } = require('../middleware/auth');
const {
  listConnections,
  listOpenConnections,
  ensureDefaultConnection,
  discoverHosts,
  testConnection,
  saveConnection,
  updateConnection,
  startConnection,
  stopConnection,
  activateConnection,
  deleteConnection
} = require('../controllers/dbConfigController');

const router = express.Router();

router.get('/list', auth, requireUserType('superadmin'), listConnections);
router.get('/open', auth, requireUserType('superadmin'), listOpenConnections);
router.post('/ensure-default', auth, requireUserType('superadmin'), ensureDefaultConnection);
router.get('/discover-hosts', auth, requireUserType('superadmin'), discoverHosts);
router.post('/test', auth, requireUserType('superadmin'), testConnection);
router.post('/save', auth, requireUserType('superadmin'), saveConnection);
router.post('/update', auth, requireUserType('superadmin'), updateConnection);
router.post('/start', auth, requireUserType('superadmin'), startConnection);
router.post('/stop', auth, requireUserType('superadmin'), stopConnection);
router.post('/activate', auth, requireUserType('superadmin'), activateConnection);
router.post('/delete', auth, requireUserType('superadmin'), deleteConnection);

module.exports = router;
