/** Shared JWT signing secret (must match JwtModule + JwtStrategy + token issuance). */

export function getJwtSecretOrThrow(): string {
  const v = process.env.JWT_SECRET?.trim();
  if (!v) {
    throw new Error(
      'JWT_SECRET is missing or empty. Set it in process.env — e.g. .env locally, Lambda/Cloud environment variables or secrets backing. Generate: openssl rand -base64 32',
    );
  }
  return v;
}
