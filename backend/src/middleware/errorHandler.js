const { fail } = require('../utils/response');
const { AppError } = require('../utils/AppError');

function notFoundHandler(req, res) {
  return fail(res, 404, 'NOT_FOUND', `Route not found: ${req.method} ${req.originalUrl}`);
}

function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return fail(res, err.status, err.code, err.message, err.details);
  }

  if (err.name === 'ZodError') {
    const issues = err.issues || err.errors || [];
    const message =
      issues[0]?.message || 'Validation failed';
    return fail(res, 422, 'VALIDATION_ERROR', message, issues);
  }

  if (err.code === '23505') {
    return fail(res, 409, 'CONFLICT', 'Duplicate record', { detail: err.detail });
  }

  if (err.code === '23503') {
    return fail(res, 400, 'FOREIGN_KEY', 'Related record not found', { detail: err.detail });
  }

  // Postgres: invalid date/time literal (e.g. free-text "5011")
  if (err.code === '22008' || err.code === '22007') {
    return fail(
      res,
      400,
      'VALIDATION_ERROR',
      'Invalid date or time. Use YYYY-MM-DD and HH:MM.',
    );
  }

  console.error('[error]', {
    path: req.originalUrl,
    method: req.method,
    message: err.message,
    code: err.code,
  });

  return fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

module.exports = { notFoundHandler, errorHandler };
