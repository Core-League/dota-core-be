import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Player } from '../players/player.entity';
import { PlayersService } from '../players/players.service';
import { VipPayment } from './vip-payment.entity';
import { VipSubscription } from './vip-subscription.entity';
import { VipService } from './vip.service';
import { VipPaymentKind, VipPaymentStatus, VipProvider } from './vip.constants';

const REGULAR = 'VIP-AAA111_T0ZZZZ';

/**
 * Deleting an account must never leave a card that keeps being charged: the
 * WayForPay regular payment is removed first, and if WayForPay cannot confirm
 * it the deletion is refused with nothing changed.
 */
describe('VipService.stopPaymentsForAccountDeletion', () => {
  const build = (
    subscription: Record<string, unknown> | null,
    options: { configured?: boolean; reasonCode?: number; down?: boolean } = {},
  ) => {
    const subscriptionRepo = {
      findOne: jest.fn().mockResolvedValue(subscription),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const wayforpay = {
      isConfigured: () => options.configured ?? true,
      regular: options.down
        ? jest.fn().mockRejectedValue(new Error('HTTP 502'))
        : jest
            .fn()
            .mockResolvedValue({ reasonCode: options.reasonCode ?? 4100 }),
    };
    const monobank = {
      deleteCardToken: jest.fn().mockResolvedValue(undefined),
    };
    const service = new VipService(
      { getRepository: () => subscriptionRepo } as never,
      monobank as never,
      {
        getEnvConfig: () => ({ MONOBANK_MERCHANT_TOKEN: 'mono' }),
      } as never,
      { changed: jest.fn() } as never,
      wayforpay as never,
    );
    return { service, subscriptionRepo, wayforpay, monobank };
  };

  const wfpSubscription = {
    id: 's1',
    playerId: 'p1',
    provider: VipProvider.WAYFORPAY,
    regularRef: REGULAR,
    cardToken: 'rec-token',
    autoRenew: true,
  };

  it('removes the WayForPay regular payment, then switches auto-renewal off', async () => {
    const { service, wayforpay, subscriptionRepo } = build(wfpSubscription);
    await service.stopPaymentsForAccountDeletion('p1');
    expect(wayforpay.regular).toHaveBeenCalledWith('REMOVE', REGULAR);
    expect(subscriptionRepo.update).toHaveBeenCalledWith(
      { id: 's1' },
      expect.objectContaining({ autoRenew: false, cardToken: null }),
    );
  });

  it('also removes a suspended (cancelled) regular payment', async () => {
    const { service, wayforpay } = build({
      ...wfpSubscription,
      autoRenew: false,
    });
    await service.stopPaymentsForAccountDeletion('p1');
    expect(wayforpay.regular).toHaveBeenCalledWith('REMOVE', REGULAR);
  });

  it('accepts a regular payment WayForPay already reports gone', async () => {
    const { service } = build(wfpSubscription, { reasonCode: 4107 });
    await expect(
      service.stopPaymentsForAccountDeletion('p1'),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['WayForPay unreachable', { down: true }, BadGatewayException],
    ['WayForPay refuses', { reasonCode: 1100 }, BadGatewayException],
    [
      'WayForPay no longer configured',
      { configured: false },
      ServiceUnavailableException,
    ],
  ] as const)('%s: refuses, changing nothing', async (_c, options, error) => {
    const { service, subscriptionRepo } = build(wfpSubscription, options);
    await expect(service.stopPaymentsForAccountDeletion('p1')).rejects.toThrow(
      error,
    );
    expect(subscriptionRepo.update).not.toHaveBeenCalled();
  });

  it('forgets a Monobank card token (only we ever charge it)', async () => {
    const { service, monobank, wayforpay, subscriptionRepo } = build({
      id: 's1',
      playerId: 'p1',
      provider: VipProvider.MONO,
      regularRef: null,
      cardToken: 'mono-token',
      autoRenew: true,
    });
    await service.stopPaymentsForAccountDeletion('p1');
    expect(monobank.deleteCardToken).toHaveBeenCalledWith('mono-token');
    expect(wayforpay.regular).not.toHaveBeenCalled();
    expect(subscriptionRepo.update).toHaveBeenCalledWith(
      { id: 's1' },
      expect.objectContaining({ autoRenew: false, cardToken: null }),
    );
  });

  it('does nothing for a player who never subscribed', async () => {
    const { service, wayforpay, subscriptionRepo } = build(null);
    await service.stopPaymentsForAccountDeletion('p1');
    expect(wayforpay.regular).not.toHaveBeenCalled();
    expect(subscriptionRepo.update).not.toHaveBeenCalled();
  });
});

describe('VIP page paid after the account was deleted', () => {
  it('credits nobody and removes the regular payment it started', async () => {
    const payment = {
      id: 'pay1',
      playerId: 'gone',
      reference: 'VIP-AAA111',
      kind: VipPaymentKind.INITIAL,
      status: VipPaymentStatus.PENDING,
      amount: 20000,
      invoiceId: REGULAR,
    };
    const repos = new Map<unknown, unknown>([
      [VipPayment, { findOne: jest.fn().mockResolvedValue(payment) }],
      [Player, { count: jest.fn().mockResolvedValue(0) }],
      [VipSubscription, {}],
    ]);
    const transaction = jest.fn();
    const wayforpay = {
      isConfigured: () => true,
      regular: jest.fn().mockResolvedValue({ reasonCode: 4100 }),
    };
    const service = new VipService(
      {
        getRepository: (entity: unknown) => repos.get(entity),
        transaction,
      } as never,
      {} as never,
      { getEnvConfig: () => ({}) } as never,
      { changed: jest.fn() } as never,
      wayforpay as never,
    );

    await expect(
      service.applyWayForPayCallback({
        orderReference: REGULAR,
        transactionStatus: 'Approved',
        amount: 200,
        currency: 'UAH',
      }),
    ).resolves.toBe(true);

    expect(wayforpay.regular).toHaveBeenCalledWith('REMOVE', REGULAR);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('PlayersService.remove (DELETE /players/:id)', () => {
  const build = (stop: jest.Mock) => {
    const calls: string[] = [];
    const playersRepo = {
      findOneById: jest.fn().mockResolvedValue({ id: 'p1' }),
      remove: jest.fn(() => {
        calls.push('remove');
        return Promise.resolve();
      }),
    };
    const teams = {
      reassignCaptaincyBeforeDeletion: jest.fn(() => {
        calls.push('captaincy');
        return Promise.resolve();
      }),
    };
    stop.mockImplementation(() => {
      calls.push('stop-payments');
      return Promise.resolve();
    });
    const service = new PlayersService(
      playersRepo as never,
      {} as never,
      teams as never,
      {} as never,
      {} as never,
      { stopPaymentsForAccountDeletion: stop } as never,
    );
    return { service, playersRepo, calls };
  };

  it('stops the regular payment before anything is deleted', async () => {
    const stop = jest.fn();
    const { service, calls } = build(stop);
    await service.remove('p1');
    expect(stop).toHaveBeenCalledWith('p1');
    expect(calls).toEqual(['stop-payments', 'captaincy', 'remove']);
  });

  it('deletes nothing when the regular payment cannot be stopped', async () => {
    const stop = jest.fn();
    const { service, playersRepo } = build(stop);
    stop.mockRejectedValue(new BadGatewayException('payment_provider'));
    await expect(service.remove('p1')).rejects.toThrow(BadGatewayException);
    expect(playersRepo.remove).not.toHaveBeenCalled();
  });
});
