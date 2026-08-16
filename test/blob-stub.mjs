/* Module resolution hook: swap @netlify/blobs for an in-memory store so the real
   API handler can be exercised in a plain Node process. */

export async function resolve(specifier, context, next) {
  if (specifier === '@netlify/blobs') {
    return { url: 'ceo-blob-stub:blobs', shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === 'ceo-blob-stub:blobs') {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        export function getStore() { return globalThis.__CEO_BLOBS__; }
        export function getDeployStore() { return globalThis.__CEO_BLOBS__; }
      `,
    };
  }
  return next(url, context);
}
