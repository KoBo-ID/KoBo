/** KoBo's public support address (also shown on /kontak). */
export const SUPPORT_EMAIL = 'support@kobo.rent';

/** A mailto link to KoBo support with a prefilled subject, e.g. for a failed refund (SIM-003). */
export const supportMailto = (subject: string): string => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
