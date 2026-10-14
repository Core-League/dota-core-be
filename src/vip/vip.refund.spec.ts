import type { TWfpTransaction } from '../connectors/wayforpay/wayforpay.types';
import { Player } from '../players/player.entity';
import { VipPayment } from './vip-payment.entity';
import { VipSubscription } from './vip-subscription.entity';
import { VipService } from './vip.service';
import {
  VIP_LIFETIME_UNTIL,
  VipPaymentKind,
  VipPaymentStatus,
  VipProvider,
} from './vip.constants';
import { addMonths } from './vip.utils';

const DAY = 24 * 3600 * 1000;
const REGULAR = 'VIP-AAA111_T0ZZZZ';

type TRow = Record<string, unknown>;

/**
 * A refunded VIP payment takes its month back once (never below now, never a
 * lifetime VIP) and stops the WayForPay regular payment it feeds with the same
 * SUSPEND a player's cancel sends.
 */
describe('VipService refunds', () => {
  const build = (options: {
    vipUntil: Date | null;
    payments: TRow[];
    subscription?: TRow | null;
  }) => {
    const player = { id: 'p1', vipUntil: options.vipUntil };
    const payments = options.payments;
    const subscription =
      options.subscription === null
        ? null
        : {
            id: 's1',
            playerId: 'p1',
            provider: VipProvider.WAYFORPAY,
            regularRef: REGULAR,
            cardToken: 'rec-token',
            autoRenew: true,
            nextChargeAt: new Date(),
            renewalClaimedAt: null,
            ...options.subscription,
          };
    const byWhere = (where: TRow) =>
      payments.find((p) =>
        Object.entries(where).every(([k, v]) => p[k] === v),
      ) ?? null;
    const subscriptionRepo = {
      findOne: jest.fn().mockResolvedValue(subscription),
      save: jest.fn((s: unknown) => Promise.resolve(s)),
      update: jest.fn((_where: unknown, patch: TRow) => {
        if (subscription) Object.assign(subscription, patch);
        return Promise.resolve({ affected: 1 });
      }),
      createQueryBuilder: () => {
        const qb = {
          where: () => qb,
          andWhere: () => qb,
          orderBy: () => qb,
          getOne: () => Promise.resolve(subscription),
        };
        return qb;
      },
    };
    const paymentRepo = {
      findOne: jest.fn(({ where }: { where: TRow }) =>
        Promise.resolve(byWhere(where)),
      ),
      find: jest.fn(() =>
        Promise.resolve(
          payments.filter((p) => p.kind === VipPaymentKind.RENEWAL),
        ),
      ),
    };
    const em = {
      findOne: jest.fn((entity: unknown, { where }: { where: TRow }) =>
        Promise.resolve(
          entity === Player
            ? player
            : entity === VipPayment
              ? byWhere(where)
              : null,
        ),
      ),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      getRepository: () => subscriptionRepo,
    };
    const repos = new Map<unknown, unknown>([
      [VipPayment, paymentRepo],
      [VipSubscription, subscriptionRepo],
    ]);
    const wayforpay = {
      isConfigured: () => true,
      regular: jest.fn().mockResolvedValue({ reasonCode: 4100 }),
    };
    const chatAccess = { changed: jest.fn() };
    const service = new VipService(
      {
        getRepository: (entity: unknown) => repos.get(entity),
        transaction: (run: (m: unknown) => unknown) => run(em),
      } as never,
      {} as never,
      { getEnvConfig: () => ({}) } as never,
      chatAccess as never,
      wayforpay as never,
    );
    return { service, player, subscription, wayforpay, chatAccess };
  };

  const initial = (over: TRow = {}): TRow => ({
    id: 'pay1',
    playerId: 'p1',
    reference: 'VIP-AAA111',
    kind: VipPaymentKind.INITIAL,
    status: VipPaymentStatus.PAID,
    amount: 20000,
    invoiceId: REGULAR,
    paidAt: new Date(Date.now() - 2 * DAY),
    ...over,
  });

  const tx = (over: Partial<TWfpTransaction> = {}): TWfpTransaction => ({
    orderReference: REGULAR,
    transactionStatus: 'Refunded',
    amount: 200,
    currency: 'UAH',
    ...over,
  });

  it.each(['Refunded', 'Voided'])(
    'WayForPay %s of the first month: month taken back, regular payment suspended',
    async (status) => {
      const until = new Date(Date.now() + 45 * DAY);
      const { service, player, subscription, wayforpay, chatAccess } = build({
        vipUntil: until,
        payments: [initial()],
      });

      await expect(
        service.applyWayForPayCallback(tx({ transactionStatus: status })),
      ).resolves.toBe(true);

      expect(player.vipUntil).toEqual(addMonths(until, -1));
      expect(subscription).toMatchObject({
        autoRenew: false,
        nextChargeAt: null,
      });
      expect(wayforpay.regular).toHaveBeenCalledWith('SUSPEND', REGULAR);
      expect(chatAccess.changed).toHaveBeenCalledWith(['p1']);
    },
  );

  it('a repeated refund callback takes nothing back twice', async () => {
    const until = new Date(Date.now() + 45 * DAY);
    const payment = initial();
    const { service, player, wayforpay } = build({
      vipUntil: until,
      payments: [payment],
    });

    await service.applyWayForPayCallback(tx());
    await service.applyWayForPayCallback(tx());
    await service.applyWayForPayCallback(tx({ transactionStatus: 'Voided' }));

    expect(payment.status).toBe(VipPaymentStatus.REFUNDED);
    expect(player.vipUntil).toEqual(addMonths(until, -1));
    expect(wayforpay.regular).toHaveBeenCalledTimes(1);
  });

  it('never moves VIP below now: a short remainder just ends', async () => {
    const before = Date.now();
    const { service, player } = build({
      vipUntil: new Date(Date.now() + 10 * DAY),
      payments: [initial()],
    });
    await service.applyWayForPayCallback(tx());
    const until = (player.vipUntil as Date).getTime();
    expect(until).toBeGreaterThanOrEqual(before);
    expect(until).toBeLessThanOrEqual(Date.now());
  });

  it('never touches a lifetime VIP, but still stops the charges', async () => {
    const { service, player, wayforpay } = build({
      vipUntil: VIP_LIFETIME_UNTIL,
      payments: [initial()],
    });
    await service.applyWayForPayCallback(tx());
    expect(player.vipUntil).toEqual(VIP_LIFETIME_UNTIL);
    expect(wayforpay.regular).toHaveBeenCalledWith('SUSPEND', REGULAR);
  });

  it('an old first payment whose regular payment was replaced leaves the current subscription alone', async () => {
    const until = new Date(Date.now() + 45 * DAY);
    const { service, player, subscription, wayforpay } = build({
      vipUntil: until,
      payments: [initial()],
      subscription: { regularRef: 'VIP-NEW222_T0ZZZZ' },
    });
    await service.applyWayForPayCallback(tx());
    expect(player.vipUntil).toEqual(addMonths(until, -1));
    expect(subscription).toMatchObject({ autoRenew: true });
    expect(wayforpay.regular).not.toHaveBeenCalled();
  });

  it('a refunded monthly charge of WayForPay takes back the month it credited', async () => {
    const chargedAt = new Date(Date.now() - 3 * DAY);
    const renewal: TRow = {
      id: 'pay2',
      playerId: 'p1',
      reference: 'VIP-BBB222',
      kind: VipPaymentKind.RENEWAL,
      status: VipPaymentStatus.PAID,
      amount: 20000,
      invoiceId: `${REGULAR}@${Math.floor(chargedAt.getTime() / 1000)}`,
      paidAt: chargedAt,
    };
    const until = new Date(Date.now() + 50 * DAY);
    const { service, player, wayforpay } = build({
      vipUntil: until,
      payments: [initial(), renewal],
    });
    const refund = tx({
      orderReference: 'WFPREG-0001',
      recToken: 'rec-token',
      createdDate: Math.floor(chargedAt.getTime() / 1000) + 60,
    });

    await service.applyWayForPayCallback(refund);
    await service.applyWayForPayCallback(refund);

    expect(renewal.status).toBe(VipPaymentStatus.REFUNDED);
    expect(player.vipUntil).toEqual(addMonths(until, -1));
    expect(wayforpay.regular).toHaveBeenCalledTimes(1);
    expect(wayforpay.regular).toHaveBeenCalledWith('SUSPEND', REGULAR);
  });

  it('a refunded charge that matches no credited month still stops the charges', async () => {
    const until = new Date(Date.now() + 27 * DAY);
    const { service, player, subscription, wayforpay } = build({
      vipUntil: until,
      payments: [initial()],
    });
    await service.applyWayForPayCallback(
      tx({ orderReference: 'WFPREG-0002', recToken: 'rec-token' }),
    );
    expect(player.vipUntil).toEqual(until);
    expect(subscription).toMatchObject({ autoRenew: false });
    expect(wayforpay.regular).toHaveBeenCalledWith('SUSPEND', REGULAR);
  });

  it('a Monobank reversal of a paid month takes it back and turns auto-renewal off', async () => {
    const until = new Date(Date.now() + 45 * DAY);
    const payment = initial({ invoiceId: 'mono_inv_1' });
    const { service, player, subscription, wayforpay } = build({
      vipUntil: until,
      payments: [payment],
      subscription: { provider: VipProvider.MONO, regularRef: null },
    });
    await service.applyInvoiceCallback({
      invoiceId: 'mono_inv_1',
      status: 'reversed',
    } as never);
    expect(payment.status).toBe(VipPaymentStatus.REFUNDED);
    expect(player.vipUntil).toEqual(addMonths(until, -1));
    expect(subscription).toMatchObject({ autoRenew: false });
    expect(wayforpay.regular).not.toHaveBeenCalled();
  });

  it('a refund of a page that never settled only closes it as failed', async () => {
    const until = new Date(Date.now() + 45 * DAY);
    const payment = initial({ status: VipPaymentStatus.PENDING });
    const { service, player } = build({
      vipUntil: until,
      payments: [payment],
    });
    await service.applyWayForPayCallback(tx({ transactionStatus: 'Voided' }));
    expect(payment.status).toBe(VipPaymentStatus.FAILED);
    expect(player.vipUntil).toEqual(until);
  });
});
