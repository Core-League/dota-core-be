import { apiOriginFrom, spaOriginFrom } from './request-origin.util';

describe('apiOriginFrom', () => {
  it('prefers the forwarded proto and host', () => {
    expect(
      apiOriginFrom({
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'api.core-league-dota2.org',
        host: 'internal:3000',
      }),
    ).toBe('https://api.core-league-dota2.org');
  });

  it('falls back to host and http when not proxied', () => {
    expect(apiOriginFrom({ host: 'localhost:3000' })).toBe(
      'http://localhost:3000',
    );
  });

  it('takes the first entry of a comma-joined forwarded chain', () => {
    expect(
      apiOriginFrom({
        'x-forwarded-proto': 'https,http',
        'x-forwarded-host': 'api.example.org,internal',
      }),
    ).toBe('https://api.example.org');
  });
});

describe('spaOriginFrom', () => {
  const allowed = ['https://core-league-dota2.org', 'http://localhost:5173'];

  it('returns the Origin header when it is allowed', () => {
    expect(spaOriginFrom({ origin: 'http://localhost:5173' }, allowed)).toBe(
      'http://localhost:5173',
    );
  });

  it('falls back to the first allowed origin when the header is absent', () => {
    expect(spaOriginFrom({}, allowed)).toBe('https://core-league-dota2.org');
  });

  it('refuses an origin that is not allow-listed', () => {
    expect(spaOriginFrom({ origin: 'https://evil.example' }, allowed)).toBe(
      'https://core-league-dota2.org',
    );
  });

  it('returns null when nothing is configured and no header is sent', () => {
    expect(spaOriginFrom({}, [])).toBeNull();
  });
});
