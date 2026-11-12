function ok(res, data = null, message = 'OK', status = 200) {
  return res.status(status).json({
    success: true,
    data,
    message,
  });
}

function created(res, data = null, message = 'Created') {
  return ok(res, data, message, 201);
}

function fail(res, status, code, message, details = undefined) {
  const body = {
    success: false,
    error: { code, message },
  };
  if (details !== undefined) body.error.details = details;
  return res.status(status).json(body);
}

module.exports = { ok, created, fail };
