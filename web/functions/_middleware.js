/**
 * Cloudflare Pages middleware — pass all requests through.
 */
export async function onRequest({ next }) {
  return next();
}
