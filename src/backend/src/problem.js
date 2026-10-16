const http = require('node:http');

const PROBLEM_TYPE_BASE = 'https://wallet-team7.local/problems/';

class ApiError extends Error {
  constructor(status, code, detail, { errors, extra } = {}) {
    super(detail);
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.extra = extra;
  }
}

function toProblem(error) {
  const slug = error.code.toLowerCase().replace(/_/g, '-');
  const body = {
    type: `${PROBLEM_TYPE_BASE}${slug}`,
    title: http.STATUS_CODES[error.status],
    status: error.status,
    code: error.code,
    detail: error.message,
  };
  if (error.errors) {
    body.errors = error.errors;
  }
  return { ...body, ...error.extra };
}

function sendProblem(res, problem) {
  res.status(problem.status).type('application/problem+json').json(problem);
}

function notFoundHandler(req, res) {
  sendProblem(res, toProblem(new ApiError(404, 'NOT_FOUND', 'Recurso no encontrado.')));
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    const status = err.type === 'entity.too.large' ? 413 : 400;
    const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
    sendProblem(res, toProblem(new ApiError(status, code, 'Cuerpo de solicitud inválido.')));
    return;
  }
  if (err instanceof ApiError) {
    sendProblem(res, toProblem(err));
    return;
  }
  sendProblem(res, toProblem(new ApiError(500, 'INTERNAL_ERROR', 'Error interno.')));
}

module.exports = { ApiError, errorHandler, notFoundHandler };
