/**
 * The credential one successful sign-in produces, and the only shape the
 * request path reads.
 *
 * `clientId` is the issued id from the authorization callback, never the
 * dynamic entry point: it is what identifies this installation's registration
 * on every later refresh. `scopes` is kept because plan usage is a *granted*
 * capability, not a requested one — a deployment can authorize identity and
 * decline plan usage, and the difference only shows up here.
 *
 * @module dsh-plugin-chatgpt-subscription/auth/credential
 */
/** Whether the stored grant includes the plan-usage scope. */
export function canSpendPlan(credential) {
    return credential.scopes.includes('chatgpt.tokens.use.direct');
}
/** Whether the access token still has useful life left. */
export function isFresh(credential, now = Date.now()) {
    return credential.expiresAt > now;
}
/** Check a local replay UUID's shape; positional account labels and emails do not qualify. */
export function isReplayNamespace(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
