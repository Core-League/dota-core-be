import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateTournamentDonationDto,
  MAX_DONATION_KOPECKS,
  MIN_DONATION_KOPECKS,
} from './create-tournament-donation.dto';

/**
 * Runs the DTO through class-validator directly, the same way the v1
 * `ValidationPipe` does, so the amount bounds and their Ukrainian messages
 * are pinned independently of any HTTP plumbing.
 */
describe('CreateTournamentDonationDto', () => {
  const validateAmount = async (amount: unknown) => {
    const dto = plainToInstance(CreateTournamentDonationDto, { amount });
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  };

  it.each([MIN_DONATION_KOPECKS, 10000, 30000, 50000, MAX_DONATION_KOPECKS])(
    'accepts %d kopecks',
    async (amount) => {
      await expect(validateAmount(amount)).resolves.toEqual([]);
    },
  );

  it('rejects a non-integer amount with a Ukrainian message', async () => {
    const messages = await validateAmount(100.5);
    expect(messages).toContain('Сума донату має бути цілим числом у копійках');
  });

  it('rejects a numeric string (no implicit coercion)', async () => {
    const messages = await validateAmount('10000');
    expect(messages).toContain('Сума донату має бути цілим числом у копійках');
  });

  it('rejects a missing amount', async () => {
    const messages = await validateAmount(undefined);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('rejects an amount below the 10 грн minimum', async () => {
    const messages = await validateAmount(MIN_DONATION_KOPECKS - 1);
    expect(messages).toEqual(['Мінімальна сума донату — 10 грн']);
  });

  it('rejects an amount above the 50 000 грн maximum', async () => {
    const messages = await validateAmount(MAX_DONATION_KOPECKS + 1);
    expect(messages).toEqual(['Максимальна сума донату — 50 000 грн']);
  });

  it('rejects zero and negative amounts', async () => {
    await expect(validateAmount(0)).resolves.toEqual([
      'Мінімальна сума донату — 10 грн',
    ]);
    await expect(validateAmount(-10000)).resolves.toEqual([
      'Мінімальна сума донату — 10 грн',
    ]);
  });
});
