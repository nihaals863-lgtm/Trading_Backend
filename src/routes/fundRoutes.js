const express = require('express');
const router = express.Router();
const { createFund, getFunds } = require('../controllers/fundController');
const { authMiddleware, roleMiddleware, brokerPermission } = require('../middleware/auth');

// Broker needs payinAllowed to add funds (payin), payoutAllowed to withdraw (payout)
router.post('/', authMiddleware, roleMiddleware(['SUPERADMIN', 'ADMIN', 'BROKER']), brokerPermission('payinAllowed'), createFund);
router.get('/', authMiddleware, roleMiddleware(['SUPERADMIN', 'ADMIN', 'BROKER']), getFunds);

module.exports = router;
