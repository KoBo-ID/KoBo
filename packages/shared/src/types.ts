// Types only. No runtime code in this entry point.
export type RoomStatus = 'paid' | 'due' | 'overdue' | 'vacant' | 'booking'
export type CampusVerifyMethod = 'EMAIL' | 'MICROSOFT' | 'GOOGLE' | 'KTM' | 'SHEERID'
export interface StudentVerificationStatus {
  state: 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED'
  via: CampusVerifyMethod | null
  until: string | null
  campus: string | null
  reason: string | null
  /** sheerid: dev/test only (refused in production); see backend/src/sheerid.ts. */
  providers: { microsoft: boolean; google: boolean; sheerid?: boolean }
}
export type WaitlistStatus = 'WAITING' | 'OFFERED' | 'FULFILLED' | 'EXPIRED' | 'DECLINED' | 'LEFT' | 'REMOVED'
