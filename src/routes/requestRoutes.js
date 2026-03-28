const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { getRequests, updateRequestStatus, createRequest } = require('../controllers/requestController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

// Multer setup for screenshots
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../../uploads'));
    },
    filename: (req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `deposit-${unique}-${file.originalname}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', authMiddleware, getRequests);

// POST with multer error handling
router.post('/', authMiddleware, (req, res, next) => {
    upload.single('screenshot')(req, res, (err) => {
        if (err) {
            console.error('Multer error:', err.message);
            return res.status(400).json({ message: 'File upload error: ' + err.message });
        }
        next();
    });
}, createRequest);

router.put('/:id', authMiddleware, roleMiddleware(['SUPERADMIN', 'ADMIN']), updateRequestStatus);

module.exports = router;
