/**
 * Deep link to a channel of the league's guild (`DISCORD_SYNC_GUILD_ID`):
 * the Discord client opens it directly, the browser offers "Open in app".
 * Null when the guild is not configured — there is nowhere to link to.
 */
export function discordChannelUrl(channelId: string): string | null {
  const guildId = process.env.DISCORD_SYNC_GUILD_ID?.trim();
  return guildId
    ? `https://discord.com/channels/${guildId}/${channelId}`
    : null;
}
