import { AppError } from './errorHandler.js';

// Use after requireAuth. Example: router.get('/', requireAuth, requireRole('admin', 'dispatcher'), handler)
export function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.user?.profile?.role;
    if (!role) return next(new AppError('Not authenticated', 401));
    if (!roles.includes(role)) return next(new AppError('Forbidden', 403));
    next();
  };
}
