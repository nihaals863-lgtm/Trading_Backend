const express = require('express');
const router = express.Router();
const { createTicket, getTickets, replyTicket } = require('../controllers/supportController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, getTickets);
router.post('/', authMiddleware, createTicket);
router.put('/:id/reply', authMiddleware, roleMiddleware(['SUPERADMIN', 'ADMIN']), replyTicket);

module.exports = router;
