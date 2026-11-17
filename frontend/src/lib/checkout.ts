/** Mirrors CHECKOUT_HOSTS on the server: the only places a tenant may be sent to pay. */
const CHECKOUT_HOSTS = new Set(['checkout.xendit.co', 'checkout-staging.xendit.co', 'xen.to', 'dev.xen.to']);
/** Only an https URL on a known checkout host is ever navigated to; anything else is refused. */
export function safeCheckoutUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && CHECKOUT_HOSTS.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

