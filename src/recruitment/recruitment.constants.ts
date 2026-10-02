/**
 * Recruitment ("Пошук команди / гравця"): team posts players apply to,
 * player listings managers invite from, and the requests between them.
 */

export enum TeamPostStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum JoinRequestKind {
  /** Player → team, against an open team post. */
  APPLICATION = 'APPLICATION',
  /** Team manager → player. */
  INVITE = 'INVITE',
}

export enum JoinRequestStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  /** Withdrawn by its author, or dropped because the player joined a team / the post closed. */
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

/** Roster slot a request ends in. */
export type TeamMemberSlot = 'main' | 'reserved' | 'coach';
export const TEAM_MEMBER_SLOTS: TeamMemberSlot[] = [
  'main',
  'reserved',
  'coach',
];

/** Why the caller cannot apply to a post / publish a listing (empty list = allowed). */
export enum RecruitmentBlockReason {
  NOT_VERIFIED = 'not_verified',
  NO_STEAM = 'no_steam',
  HAS_TEAM = 'has_team',
  NO_POSITIONS = 'no_positions',
  MMR_TOO_LOW = 'mmr_too_low',
  MMR_TOO_HIGH = 'mmr_too_high',
  POSITION_MISMATCH = 'position_mismatch',
}

export const RECRUITMENT_BLOCK_MESSAGES: Record<
  RecruitmentBlockReason,
  string
> = {
  [RecruitmentBlockReason.NOT_VERIFIED]: 'Потрібна верифікація акаунта',
  [RecruitmentBlockReason.NO_STEAM]: 'Привʼяжіть Steam у профілі',
  [RecruitmentBlockReason.HAS_TEAM]: 'Ви вже в команді',
  [RecruitmentBlockReason.NO_POSITIONS]: 'Вкажіть позиції у профілі',
  [RecruitmentBlockReason.MMR_TOO_LOW]: 'Ваш MMR нижчий за потрібний',
  [RecruitmentBlockReason.MMR_TOO_HIGH]: 'Ваш MMR вищий за потрібний',
  [RecruitmentBlockReason.POSITION_MISMATCH]: 'Команда шукає інші позиції',
};

export const RECRUITMENT_TEXT_MAX_LENGTH = 200;
export const RECRUITMENT_MMR_MAX = 22000;
export const RECRUITMENT_PLAYERS_NEEDED_MAX = 5;

/** Applications a non-VIP player may send per rolling 24 h. */
export const DAILY_APPLICATION_LIMIT = 5;
/** Invites a team may send per rolling 24 h unless the sender is VIP / admin. */
export const DAILY_INVITE_LIMIT = 5;
export const DAILY_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export const APPLICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const RECRUITMENT_PAGE_SIZE_DEFAULT = 25;
export const RECRUITMENT_PAGE_SIZE_MAX = 50;

export const MAIN_ROSTER_SIZE = 5;
export const RESERVE_ROSTER_SIZE = 3;
