const express = require('express');
const { auth, requireUserType } = require('../middleware/auth');
const { createUser, listUsers, updateUser, deleteUser, resetPassword, overrideUserType, assignRole } = require('../controllers/userController');

const router = express.Router();

router.post('/create', auth, requireUserType('admin', 'superadmin'), createUser);
router.get('/', auth, requireUserType('admin', 'superadmin'), listUsers);
router.post('/update', auth, requireUserType('admin', 'superadmin'), updateUser);
router.post('/delete', auth, requireUserType('admin', 'superadmin'), deleteUser);
router.post('/reset-password', auth, requireUserType('admin', 'superadmin'), resetPassword);
router.post('/assign-role', auth, requireUserType('admin', 'superadmin'), assignRole);
router.post('/override-type', auth, requireUserType('superadmin'), overrideUserType);

module.exports = router;
