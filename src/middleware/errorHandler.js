export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  if (statusCode >= 500) {
    console.error(err);
  }
  res.status(statusCode).json({ error: err.message || 'Internal server error' });
}
