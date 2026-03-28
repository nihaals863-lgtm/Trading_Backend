const db = require('../config/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Tables are now created by src/config/migrate.js on server startup.

// ─── UPLOAD DIR SETUP ─────────────────────────────────

const uploadDir = path.join(__dirname, '../../uploads/logo');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const profileDir = path.join(__dirname, '../../uploads/profile');
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'profileImage') cb(null, profileDir);
        else cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `tmp-${Date.now()}${path.extname(file.originalname).toLowerCase()}`);
    },
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        // Only process logo and profileImage fields
        if (file.fieldname !== 'logo' && file.fieldname !== 'profileImage') {
            return cb(null, false); // skip unknown fields silently
        }
        const mimeOk = /^image\//.test(file.mimetype);
        cb(null, mimeOk); // accept images, discard non-images without throwing
    },
    limits: { fileSize: 5 * 1024 * 1024 },
});

// Accepts both logo and profileImage fields
const uploadPanelFilesMiddleware = upload.fields([
    { name: 'logo',         maxCount: 1 },
    { name: 'profileImage', maxCount: 1 },
    { name: 'bgImage',      maxCount: 1 },
]);

// Keep old single-field middleware for legacy /logo route
const uploadLogoMiddleware = upload.single('logo');

// ─── MENU PERMISSIONS ─────────────────────────────────

const getMenuPermissions = async (req, res) => {
    const { userId } = req.params;
    try {
        const [rows] = await db.execute(
            'SELECT menu_id FROM admin_menu_permissions WHERE user_id = ?',
            [userId]
        );
        res.json({ menuPermissions: rows.map(r => r.menu_id) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

const saveMenuPermissions = async (req, res) => {
    const { userId } = req.params;
    const { menuPermissions } = req.body;
    try {
        await db.execute('DELETE FROM admin_menu_permissions WHERE user_id = ?', [userId]);
        if (menuPermissions && menuPermissions.length > 0) {
            const values = menuPermissions.map(menuId => [parseInt(userId), menuId]);
            await db.query('INSERT INTO admin_menu_permissions (user_id, menu_id) VALUES ?', [values]);
        }
        res.json({ message: 'Permissions saved' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

// ─── PER-ADMIN PANEL SETTINGS (theme + logo + profileImage) ───────────────────
// POST /api/admin/panel-settings/:userId
// Body: multipart — theme (JSON string), logo (file, optional), profileImage (file, optional)

const savePanelSettings = async (req, res) => {
    const { userId } = req.params;
    try {
        // Parse theme JSON
        let themeJson = null;
        if (req.body.theme) {
            try {
                JSON.parse(req.body.theme); // validate
                themeJson = req.body.theme;
            } catch (_) {}
        }

        // Handle logo file
        let logoPath = null;
        const logoFile = req.files?.logo?.[0];
        if (logoFile) {
            const ext = path.extname(logoFile.originalname).toLowerCase();
            const newFilename = `logo-${userId}${ext}`;
            const newFilePath = path.join(uploadDir, newFilename);
            if (fs.existsSync(logoFile.path)) fs.renameSync(logoFile.path, newFilePath);
            logoPath = `/uploads/logo/${newFilename}`;
        }

        // Handle profile image file
        let profileImagePath = null;
        const profileFile = req.files?.profileImage?.[0];
        if (profileFile) {
            const ext = path.extname(profileFile.originalname).toLowerCase();
            const newFilename = `profile-${userId}${ext}`;
            const newFilePath = path.join(profileDir, newFilename);
            if (fs.existsSync(profileFile.path)) fs.renameSync(profileFile.path, newFilePath);
            profileImagePath = `/uploads/profile/${newFilename}`;
        }

        // Handle background image file
        let bgImagePath = null;
        const bgFile = req.files?.bgImage?.[0];
        if (bgFile) {
            const bgDir = path.join(__dirname, '../../uploads/bg');
            if (!fs.existsSync(bgDir)) fs.mkdirSync(bgDir, { recursive: true });
            const ext = path.extname(bgFile.originalname).toLowerCase();
            const newFilename = `bg-${userId}${ext}`;
            const newFilePath = path.join(bgDir, newFilename);
            if (fs.existsSync(bgFile.path)) fs.renameSync(bgFile.path, newFilePath);
            bgImagePath = `/uploads/bg/${newFilename}`;
        }

        // Build upsert — only update columns that were provided
        const cols = [];
        const vals = [];

        if (themeJson !== null)        { cols.push('theme_json');         vals.push(themeJson); }
        if (logoPath !== null)         { cols.push('logo_path');           vals.push(logoPath); }
        if (profileImagePath !== null) { cols.push('profile_image_path'); vals.push(profileImagePath); }
        if (bgImagePath !== null)      { cols.push('bg_image_path');      vals.push(bgImagePath); }

        if (cols.length > 0) {
            const colList    = cols.join(', ');
            const placeholders = cols.map(() => '?').join(', ');
            const updateClause = cols.map(c => `${c} = VALUES(${c})`).join(', ');
            await db.execute(
                `INSERT INTO admin_panel_settings (user_id, ${colList})
                 VALUES (?, ${placeholders})
                 ON DUPLICATE KEY UPDATE ${updateClause}`,
                [userId, ...vals]
            );
        }

        res.json({ message: 'Panel settings saved', logoPath, profileImagePath, bgImagePath });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

// GET per-admin settings (SUPERADMIN use — to prefill edit form)
const getPanelSettings = async (req, res) => {
    const { userId } = req.params;
    try {
        const [rows] = await db.execute(
            'SELECT theme_json, logo_path, profile_image_path, bg_image_path FROM admin_panel_settings WHERE user_id = ?',
            [userId]
        );
        let theme = {};
        let logoPath = null;
        let profileImagePath = null;
        let bgImagePath = null;
        if (rows[0]) {
            if (rows[0].theme_json) {
                try { theme = JSON.parse(rows[0].theme_json); } catch (_) {}
            }
            logoPath = rows[0].logo_path || null;
            profileImagePath = rows[0].profile_image_path || null;
            bgImagePath = rows[0].bg_image_path || null;
        }
        res.json({ theme, logoPath, profileImagePath, bgImagePath });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

// ─── INIT DATA (called once after login) ──────────────

const getInitData = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        // Menu permissions — only for ADMIN role
        let menuPermissions = null;
        if (role === 'ADMIN') {
            const [rows] = await db.execute(
                'SELECT menu_id FROM admin_menu_permissions WHERE user_id = ?',
                [userId]
            );
            menuPermissions = rows.map(r => r.menu_id);
        }

        // Per-admin theme + logo + profileImage — SUPERADMIN always gets empty (uses default)
        let theme = {};
        let logoPath = null;
        let profileImagePath = null;

        if (role === 'ADMIN') {
            const [rows] = await db.execute(
                'SELECT theme_json, logo_path, profile_image_path FROM admin_panel_settings WHERE user_id = ?',
                [userId]
            );
            if (rows[0]) {
                if (rows[0].theme_json) {
                    try { theme = JSON.parse(rows[0].theme_json); } catch (_) {}
                }
                logoPath = rows[0].logo_path || null;
                profileImagePath = rows[0].profile_image_path || null;
            }
        }

        res.json({ menuPermissions, theme, logoPath, profileImagePath });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

// ─── LEGACY ENDPOINTS (kept for compatibility) ────────

const getTheme = async (req, res) => res.json({ theme: {} });
const saveTheme = async (req, res) => res.json({ message: 'Use /panel-settings/:userId instead' });
const getLogo = async (req, res) => res.json({ logoPath: null });
const uploadLogo = async (req, res) => res.json({ logoPath: null });

module.exports = {
    getMenuPermissions,
    saveMenuPermissions,
    savePanelSettings,
    getPanelSettings,
    getTheme,
    saveTheme,
    uploadLogoMiddleware,
    uploadPanelFilesMiddleware,
    uploadLogo,
    getLogo,
    getInitData,
};
