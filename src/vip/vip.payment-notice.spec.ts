import { Player } from '../players/player.entity';
import { VipPayment } from './vip-payment.entity';
import { VipSubscription } from './vip-subscription.entity';
import { VipService } from './vip.service';
import { VipProvider } from './vip.constants';

const DAY = 24 * 3600 * 1000;

/**
 * Who sees the "payment method changed" pop-up after the switch to WayForPay:
 * players whose paid VIP lost its Monobank auto-renewal, and admins — never a
 * player whose VIP was only granted by an admin, and never twice.
 */
describe('VipService payment notice', () => {
  const build = (options: {
    vipUntil?: Date | null;
    admin?: boolean;
    subscription?: Partial<VipSubscription> | null;
    seenAt?: Date | null;
    wayforpay?: boolean;
  }) => {
    const player = {
      id: 'p1',
      vipUntil: options.vipUntil ?? null,
      vipFrameColor: null,
      roles: options.admin ? [{ isAdminRole: true }] : [],
    };
    const repos = new Map<unknown, unknown>([
      [
        Player,
        {
          findOne: jest.fn().mockResolvedValue(player),
          createQueryBuilder: () => {
            const qb = {
              select: () => qb,
              where: () => qb,
              getRawOne: () =>
                Promise.resolve({ seenAt: options.seenAt ?? null }),
            };
            return qb;
          },
        },
      ],
      [VipPayment, { count: jest.fn().mockResolvedValue(0) }],
      [
        VipSubscription,
        {
          findOne: jest.fn().mockResolvedValue(
            options.subscription === null
              ? null
              : {
                  provider: VipProvider.MONO,
                  autoRenew: false,
                  cardToken: null,
                  discountPercent: 10,
                  paymentSwitchedAt: new Date(),
                  ...options.subscription,
                },
          ),
        },
      ],
    ]);
    const dataSource = {
      getRepository: (entity: unknown) => repos.get(entity),
    };
    const wayforpay = {
      isConfigured: () => options.wayforpay ?? true,
    };
    return new VipService(
      dataSource as never,
      {} as never,
      { getEnvConfig: () => ({ MONOBANK_MERCHANT_TOKEN: 'mono' }) } as never,
      { changed: jest.fn() } as never,
      wayforpay as never,
    );
  };

  const running = new Date(Date.now() + 10 * DAY);

  it('tells a player whose paid VIP still runs: until when, and 10% off from now on', async () => {
    const status = await build({ vipUntil: running }).getStatus('p1');
    expect(status.paymentNotice).toEqual({
      vipUntil: running,
      discountPercent: 10,
      priceKopecks: 18000,
      fullPriceKopecks: 20000,
      adminPreview: false,
    });
    expect(status.priceKopecks).toBe(18000);
    expect(status.paymentProvider).toBe('wayforpay');
    // Monobank is retired: its card can never be switched back on.
    expect(status.hasSavedCard).toBe(false);
  });

  it('shows admins the same card as a preview', async () => {
    const status = await build({ admin: true, subscription: null }).getStatus(
      'p1',
    );
    expect(status.paymentNotice).toMatchObject({
      vipUntil: null,
      adminPreview: true,
    });
  });

  it('skips a VIP granted by an admin (never paid), a lifetime VIP and a lapsed one', async () => {
    const granted = await build({
      vipUntil: running,
      subscription: null,
    }).getStatus('p1');
    expect(granted.paymentNotice).toBeNull();
    const lifetime = await build({
      vipUntil: new Date('9999-12-31T00:00:00.000Z'),
    }).getStatus('p1');
    expect(lifetime.paymentNotice).toBeNull();
    const lapsed = await build({
      vipUntil: new Date(Date.now() - DAY),
    }).getStatus('p1');
    expect(lapsed.paymentNotice).toBeNull();
  });

  it('is shown once, not after re-subscribing, and not before the switch', async () => {
    expect(
      (await build({ vipUntil: running, seenAt: new Date() }).getStatus('p1'))
        .paymentNotice,
    ).toBeNull();
    expect(
      (
        await build({
          vipUntil: running,
          subscription: {
            provider: VipProvider.WAYFORPAY,
            regularRef: 'VIP-AAA111_X',
            autoRenew: true,
          },
        }).getStatus('p1')
      ).paymentNotice,
    ).toBeNull();
    const before = await build({
      vipUntil: running,
      wayforpay: false,
    }).getStatus('p1');
    expect(before.paymentNotice).toBeNull();
    expect(before.paymentProvider).toBe('monobank');
  });
});
