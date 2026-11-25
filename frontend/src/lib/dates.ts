import { formatDateID, formatDateTimeWIB as sharedDateTimeWIB } from '@kobo/shared/domain';

/** 'YYYY-MM-DD' (a WIB calendar day) as "26 November 2026"; '-' when missing or invalid. Same formatter as the emails. */
export const formatLongDateWIB = (day: string | null | undefined): string => (day ? (formatDateID(day) ?? '-') : '-');

/** An ISO timestamp as "26 November 2026 pukul 14.30 WIB"; '-' when missing or invalid. Same formatter as the emails. */
export const formatDateTimeWIB = (iso: string | null | undefined): string => (iso ? (sharedDateTimeWIB(iso) ?? '-') : '-');
