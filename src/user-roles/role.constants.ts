/** Values stored in `user_roles.name` (Ukrainian). */
export const Role = {
  GUEST: 'Гість',
  PLAYER: 'Гравець',
  CAPTAIN: 'Капітан',
  ADMIN: 'Адмін',
  MEDIA: 'Медіа',
  /** Ті самі права, що й «Адмін» (`isAdminRole: true`); відрізняється лише відображенням на фронті. */
  IT: 'IT',
} as const;

export type RoleName = (typeof Role)[keyof typeof Role];

/** Синхронізовано з DB constraint `CHK_user_roles_name_allowed` — нова роль потребує міграції. */
export const ROLE_NAMES: readonly RoleName[] = [
  Role.GUEST,
  Role.PLAYER,
  Role.CAPTAIN,
  Role.MEDIA,
  Role.ADMIN,
  Role.IT,
];

/** Stable IDs for system role catalog rows (`playerId` is null in DB). */
export const ROLE_CATALOG_IDS = {
  GUEST: '38c8837a-99b8-4262-937e-5fe2c58147bd',
  PLAYER: '1467ac22-bf2c-4e5b-b9aa-487fc51ae49e',
  CAPTAIN: 'a30f9d64-2336-4502-beac-f1d6dcb01987',
  MEDIA: 'b21f4c8a-6d3e-4f1b-9c7a-8e5d2b1f4a6c',
  ADMIN: '5c298c1d-33ce-4465-b2df-5b783c0513f9',
  IT: '6efbd553-5838-4bdc-bfba-49a47e5628d1',
} as const;

export const ROLE_CATALOG_DISPLAY_ORDER: readonly string[] = [
  ROLE_CATALOG_IDS.GUEST,
  ROLE_CATALOG_IDS.PLAYER,
  ROLE_CATALOG_IDS.CAPTAIN,
  ROLE_CATALOG_IDS.MEDIA,
  ROLE_CATALOG_IDS.ADMIN,
  ROLE_CATALOG_IDS.IT,
];

/** Defaults for stable catalog UUIDs (used when DB row is missing or mis-linked). */
export function getSystemCatalogRoleSpec(
  id: string,
): { name: RoleName; isAdminRole: boolean } | undefined {
  const table: Record<string, { name: RoleName; isAdminRole: boolean }> = {
    [ROLE_CATALOG_IDS.GUEST]: { name: Role.GUEST, isAdminRole: false },
    [ROLE_CATALOG_IDS.PLAYER]: { name: Role.PLAYER, isAdminRole: false },
    [ROLE_CATALOG_IDS.CAPTAIN]: { name: Role.CAPTAIN, isAdminRole: false },
    [ROLE_CATALOG_IDS.MEDIA]: { name: Role.MEDIA, isAdminRole: false },
    [ROLE_CATALOG_IDS.ADMIN]: { name: Role.ADMIN, isAdminRole: true },
    [ROLE_CATALOG_IDS.IT]: { name: Role.IT, isAdminRole: true },
  };
  return table[id];
}

/**
 * Hex for UI (`#RRGGBB`), під parseHexColor на фронті.
 * Гість — нейтральний сірий, гравець — синій, капітан — золотистий, медіа — фіолетовий, адмін — контрастний акцент,
 * IT — нейтральний сірий (без власного акценту).
 */
export const ROLE_COLOR_HEX: Record<RoleName, string> = {
  [Role.GUEST]: '#64748B',
  [Role.PLAYER]: '#2563EB',
  [Role.CAPTAIN]: '#D97706',
  [Role.MEDIA]: '#7C3AED',
  [Role.ADMIN]: '#B91C1C',
  [Role.IT]: '#64748B',
};

/** Ролі з адмінськими правами (`isAdminRole: true`). */
export const ADMIN_ROLE_NAMES: readonly RoleName[] = [Role.ADMIN, Role.IT];

export function isAdminRoleName(name: string): boolean {
  return (ADMIN_ROLE_NAMES as readonly string[]).includes(name);
}

export function getRoleColorByName(name: string): string | null {
  if (!(ROLE_NAMES as readonly string[]).includes(name)) {
    return null;
  }
  return ROLE_COLOR_HEX[name as RoleName];
}
