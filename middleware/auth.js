import jwt from 'jsonwebtoken';

export const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('[Auth] Authorization header:', authHeader ? 'present' : 'missing');

    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header provided' });
    }

    const token = authHeader.split(' ')[1];
    console.log('[Auth] Token extracted:', token ? 'yes' : 'no');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const secret = process.env.JWT_SECRET || 'your-secret-key';
    console.log('[Auth] Using JWT secret:', secret.substring(0, 10) + '...');

    const decoded = jwt.verify(token, secret);
    console.log('[Auth] Token verified, user:', decoded.email, 'role:', decoded.role);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('[Auth] Token verification failed:', error.message);
    res.status(401).json({ error: 'Invalid token', message: error.message });
  }
};

export const adminOnly = (req, res, next) => {
  console.log('[Auth] Checking admin role, user role:', req.user?.role);
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};
