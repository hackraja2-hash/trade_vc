const express = require('express');
const { auth, requireUserType } = require('../middleware/auth');
const { createRole, listRoles } = require('../controllers/roleController');

const router = express.Router();

router.post('/', auth, requireUserType('superadmin'), createRole);
router.get('/', auth, requireUserType('admin', 'superadmin'), listRoles);

module.exports = router;
