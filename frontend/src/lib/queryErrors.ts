/** tRPC errors carry the HTTP-ish code in `data.code`. Duck-typed so this file imports nothing. */
export const errorCode = (error: unknown): string | undefined =>
  (error as { data?: { code?: string } } | null)?.data?.code;

export const isNotFound = (error: unknown): boolean => errorCode(error) === 'NOT_FOUND';
