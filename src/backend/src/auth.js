const crypto = require('node:crypto');
const { ApiError } = require('./problem');

const MIN_TOKEN_LENGTH = 16;

function bearerToken(header) {
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

// El token nunca se guarda ni se registra; solo su hash identifica al usuario mock.
function requireAuth(req, res, next) {
  const token = bearerToken(req.get('authorization'));
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    next(new ApiError(401, 'UNAUTHORIZED', 'Token ausente o inválido.'));
    return;
  }
  req.userId = crypto.createHash('sha256').update(token).digest('hex');
  next();
}

module.exports = { requireAuth };
