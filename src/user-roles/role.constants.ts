/** Values stored in `user_roles.name` (Ukrainian). */
export const Role = {
  GUEST: 'Гість',
  PLAYER: 'Гравець',
  CAPTAIN: 'Капітан',
  ADMIN: 'Адмін',
} as const;

export type RoleName = (typeof Role)[keyof typeof Role];

export const ROLE_NAMES: readonly RoleName[] = [
  Role.GUEST,
  Role.PLAYER,
  Role.CAPTAIN,
  Role.ADMIN,
];

/** Stable IDs for the four system role types (`playerId` is null in DB). */
export const ROLE_CATALOG_IDS = {
  GUEST: '38c8837a-99b8-4262-937e-5fe2c58147bd',
  PLAYER: '1467ac22-bf2c-4e5b-b9aa-487fc51ae49e',
  CAPTAIN: 'a30f9d64-2336-4502-beac-f1d6dcb01987',
  ADMIN: '5c298c1d-33ce-4465-b2df-5b783c0513f9',
} as const;

export const ROLE_CATALOG_DISPLAY_ORDER: readonly string[] = [
  ROLE_CATALOG_IDS.GUEST,
  ROLE_CATALOG_IDS.PLAYER,
  ROLE_CATALOG_IDS.CAPTAIN,
  ROLE_CATALOG_IDS.ADMIN,
];

/**
 * Hex for UI (`#RRGGBB`), під parseHexColor на фронті.
 * Гість — нейтральний сірий, гравець — синій, капітан — золотистий, адмін — контрастний акцент.
 */
export const ROLE_COLOR_HEX: Record<RoleName, string> = {
  [Role.GUEST]: '#64748B',
  [Role.PLAYER]: '#2563EB',
  [Role.CAPTAIN]: '#D97706',
  [Role.ADMIN]: '#B91C1C',
};

export function getRoleColorByName(name: string): string | null {
  if (!(ROLE_NAMES as readonly string[]).includes(name)) {
    return null;
  }
  return ROLE_COLOR_HEX[name as RoleName];
}
