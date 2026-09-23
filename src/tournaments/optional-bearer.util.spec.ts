import { playerIdFromOptionalBearer } from './optional-bearer.util';

describe('playerIdFromOptionalBearer', () => {
  const jwtAccepting = (payload: Record<string, unknown>) => ({
    verify: jest.fn().mockReturnValue(payload),
  });
  const jwtRejecting = () => ({
    verify: jest.fn(() => {
      throw new Error('jwt expired');
    }),
  });

  it('returns the subject of a valid access token', () => {
    const jwt = jwtAccepting({ sub: 'player-1' });
    expect(
      playerIdFromOptionalBearer({ authorization: 'Bearer abc.def.ghi' }, jwt),
    ).toBe('player-1');
    expect(jwt.verify).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('accepts the scheme case-insensitively and takes the first header value', () => {
    const jwt = jwtAccepting({ sub: 'player-1' });
    expect(
      playerIdFromOptionalBearer(
        { authorization: ['bearer tok', 'Bearer other'] },
        jwt,
      ),
    ).toBe('player-1');
    expect(jwt.verify).toHaveBeenCalledWith('tok');
  });

  it('returns null without verifying when there is no Authorization header', () => {
    const jwt = jwtAccepting({ sub: 'player-1' });
    expect(playerIdFromOptionalBearer({}, jwt)).toBeNull();
    expect(playerIdFromOptionalBearer({ authorization: '' }, jwt)).toBeNull();
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  it('returns null without verifying for a non-bearer or malformed header', () => {
    const jwt = jwtAccepting({ sub: 'player-1' });
    expect(
      playerIdFromOptionalBearer({ authorization: 'Basic dXNlcjpwdw==' }, jwt),
    ).toBeNull();
    expect(playerIdFromOptionalBearer({ authorization: 'Bearer' }, jwt)).toBe(
      null,
    );
    expect(
      playerIdFromOptionalBearer({ authorization: 'Bearer a b' }, jwt),
    ).toBeNull();
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  it('returns null (never throws) for an expired or forged token', () => {
    expect(
      playerIdFromOptionalBearer(
        { authorization: 'Bearer bad' },
        jwtRejecting(),
      ),
    ).toBeNull();
  });

  it('refuses typ-tagged state tokens and tokens without a string sub', () => {
    expect(
      playerIdFromOptionalBearer(
        { authorization: 'Bearer t' },
        jwtAccepting({ typ: 'steam_link', sub: 'player-1' }),
      ),
    ).toBeNull();
    expect(
      playerIdFromOptionalBearer(
        { authorization: 'Bearer t' },
        jwtAccepting({ typ: 'oauth_state', v: 1 }),
      ),
    ).toBeNull();
    expect(
      playerIdFromOptionalBearer(
        { authorization: 'Bearer t' },
        jwtAccepting({ sub: 42 }),
      ),
    ).toBeNull();
    expect(
      playerIdFromOptionalBearer(
        { authorization: 'Bearer t' },
        jwtAccepting({}),
      ),
    ).toBeNull();
  });
});
