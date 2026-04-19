export const Role = {
  ADMIN: 'admin',
  GUEST: 'guest',
  USER: 'user',
} as const;

export type RoleName = (typeof Role)[keyof typeof Role];
