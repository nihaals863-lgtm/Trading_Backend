const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

const roleMiddleware = (allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied: Insufficient permissions' });
    }
    next();
  };
};

// Broker permission middleware — checks broker_shares.permissions_json
// permissionKey: one of 'subBrokerActions','payinAllowed','payoutAllowed',
//   'createClientsAllowed','clientTasksAllowed','tradeActivityAllowed',
//   'notificationsAllowed','canViewBackupData'
const brokerPermission = (permissionKey) => {
  return async (req, res, next) => {
    // SUPERADMIN and ADMIN bypass broker permission checks
    if (req.user.role === 'SUPERADMIN' || req.user.role === 'ADMIN') {
      return next();
    }
    // Only enforce on BROKER role
    if (req.user.role !== 'BROKER') {
      return next();
    }
    try {
      const db = require('../config/db');
      const [rows] = await db.execute(
        'SELECT permissions_json FROM broker_shares WHERE user_id = ?',
        [req.user.id]
      );
      if (rows.length === 0) {
        return res.status(403).json({ message: 'Broker configuration not found' });
      }
      const permissions = JSON.parse(rows[0].permissions_json || '{}');

      // Attach all permissions to req.user for use in controllers
      req.user.permissions = permissions;

      if (permissions[permissionKey] !== 'Yes') {
        return res.status(403).json({
          message: `Permission denied: ${permissionKey} is not enabled for your account`
        });
      }
      next();
    } catch (err) {
      console.error('Broker permission check error:', err);
      res.status(500).json({ message: 'Permission check failed' });
    }
  };
};

module.exports = { authMiddleware, roleMiddleware, brokerPermission };
