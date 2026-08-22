import app from '../server/index.js';

export default function handler(request, response) {
  const forwardedPath = Array.isArray(request.query?.path)
    ? request.query.path.join('/')
    : String(request.query?.path || '');

  request.url = forwardedPath ? `/api/${forwardedPath}` : '/api';
  return app(request, response);
}
