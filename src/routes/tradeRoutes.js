const express = require('express');
const router = express.Router();
const { placeOrder, getTrades, getGroupTrades, closeTrade, deleteTrade, updateTrade, restoreTrade, modifyPendingOrder } = require('../controllers/tradeController');
const { authMiddleware, roleMiddleware, brokerPermission } = require('../middleware/auth');

router.get('/health', (req, res) => res.json({ status: 'OK', message: 'Trade routes active' }));
router.get('/', authMiddleware, getTrades);
router.post('/', authMiddleware, brokerPermission('tradeActivityAllowed'), placeOrder);
router.get('/group', authMiddleware, getGroupTrades);
router.get('/active', authMiddleware, getGroupTrades);
router.get('/closed', authMiddleware, getTrades);
router.post('/place', authMiddleware, brokerPermission('tradeActivityAllowed'), placeOrder);
router.put('/:id/close', authMiddleware, roleMiddleware(['SUPERADMIN', 'ADMIN', 'BROKER']), brokerPermission('tradeActivityAllowed'), closeTrade);
router.put('/:id/modify', authMiddleware, modifyPendingOrder);
router.put('/:id', authMiddleware, roleMiddleware(['SUPERADMIN', 'ADMIN']), updateTrade);
router.put('/:id/restore', authMiddleware, roleMiddleware(['SUPERADMIN', 'ADMIN']), restoreTrade);
router.delete('/:id', authMiddleware, roleMiddleware(['SUPERADMIN', 'ADMIN']), deleteTrade);

module.exports = router;
