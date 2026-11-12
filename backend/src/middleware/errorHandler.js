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
    return fail(res, 422, 'VALIDATION_ERROR', 'Validation failed', err.errors);
  }

  if (err.code === '23505') {
    return fail(res, 409, 'CONFLICT', 'Duplicate record', { detail: err.detail });
  }

  if (err.code === '23503') {
    return fail(res, 400, 'FOREIGN_KEY', 'Related record not found', { detail: err.detail });
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
