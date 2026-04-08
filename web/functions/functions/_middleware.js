/**
 * Cloudflare Pages middleware.
 * Block direct access via eeg.sigmacog.xyz.
 * Requests via proxy (sgimacog-web.pages.dev) pass through.
 */
export async function onRequest({ request, next }) {
  const host = new URL(request.url).hostname;
  if (host === 'eeg.sigmacog.xyz') {
    return new Response('Access denied', { status: 403 });
  }
  return next();
}
