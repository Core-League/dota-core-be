/** Social channels shown on the admin analytics dashboard. */
export enum SocialChannel {
  DISCORD = 'discord',
  TELEGRAM = 'telegram',
  YOUTUBE = 'youtube',
  INSTAGRAM = 'instagram',
  TIKTOK = 'tiktok',
  TWITCH = 'twitch',
}

export const SOCIAL_CHANNELS: readonly SocialChannel[] =
  Object.values(SocialChannel);

/**
 * Where the follower count came from:
 * - `live` — fetched from the platform (cached for a few minutes);
 * - `manual` — the value an admin entered via `PUT /admin/analytics/socials/:channel`;
 * - `unavailable` — no live source is configured and nothing was entered yet.
 */
export type SocialFollowersSource = 'live' | 'manual' | 'unavailable';

export interface SocialChannelDefinition {
  channel: SocialChannel;
  label: string;
  url: string;
  /** Public handle / invite code the live fetcher uses. */
  handle: string;
}

/** Same links as the site footer; keep the two in sync. */
export const SOCIAL_CHANNEL_CATALOG: Readonly<
  Record<SocialChannel, SocialChannelDefinition>
> = {
  [SocialChannel.DISCORD]: {
    channel: SocialChannel.DISCORD,
    label: 'Discord',
    url: 'https://discord.gg/QeDj9TjmgM',
    handle: 'QeDj9TjmgM',
  },
  [SocialChannel.TELEGRAM]: {
    channel: SocialChannel.TELEGRAM,
    label: 'Telegram',
    url: 'https://t.me/core_league_lviv',
    handle: 'core_league_lviv',
  },
  [SocialChannel.YOUTUBE]: {
    channel: SocialChannel.YOUTUBE,
    label: 'YouTube',
    url: 'https://www.youtube.com/@Core_League',
    handle: 'Core_League',
  },
  [SocialChannel.INSTAGRAM]: {
    channel: SocialChannel.INSTAGRAM,
    label: 'Instagram',
    url: 'https://www.instagram.com/core_league_lviv/',
    handle: 'core_league_lviv',
  },
  [SocialChannel.TIKTOK]: {
    channel: SocialChannel.TIKTOK,
    label: 'TikTok',
    url: 'https://www.tiktok.com/@core_league_lviv',
    handle: 'core_league_lviv',
  },
  [SocialChannel.TWITCH]: {
    channel: SocialChannel.TWITCH,
    label: 'Twitch',
    url: 'https://www.twitch.tv/core_league',
    handle: 'core_league',
  },
};
