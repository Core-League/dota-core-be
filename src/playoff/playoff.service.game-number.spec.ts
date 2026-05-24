describe('gameNumber assignment', () => {
  it('assigns gameNumber 1 for first game in series', () => {
    const existingGames: { challongeMatchId: string }[] = [];
    const challongeMatchId = 'match-42';
    const count = existingGames.filter(
      (g) => g.challongeMatchId === challongeMatchId,
    ).length;
    expect(count + 1).toBe(1);
  });

  it('assigns gameNumber 2 for second game in series', () => {
    const existingGames = [{ challongeMatchId: 'match-42' }];
    const challongeMatchId = 'match-42';
    const count = existingGames.filter(
      (g) => g.challongeMatchId === challongeMatchId,
    ).length;
    expect(count + 1).toBe(2);
  });

  it('assigns gameNumber 3 for third game in series', () => {
    const existingGames = [
      { challongeMatchId: 'match-42' },
      { challongeMatchId: 'match-42' },
    ];
    const challongeMatchId = 'match-42';
    const count = existingGames.filter(
      (g) => g.challongeMatchId === challongeMatchId,
    ).length;
    expect(count + 1).toBe(3);
  });
});
