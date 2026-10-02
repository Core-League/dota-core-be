import { TeamsService } from './teams.service';
import { Role } from '../user-roles/role.constants';
import type { TeamsRepository } from './teams.repository';
import type { DataSource } from 'typeorm';
import type { Team } from './team.entity';
import { ChatAccessEvents } from '../chat/chat-access.events';

/**
 * Focused unit tests for the application-level Captain (Капітан) user-role
 * grant/revoke logic that keeps `user_roles` in sync across captain transitions.
 * These are the pieces that were missing in changeCaptain / removePlayerFromTeam.
 */
describe('TeamsService captain user-role sync', () => {
  // Surface the private helpers under test without leaking `any`.
  type CaptainRoleSurface = {
    grantCaptainRole(playerId: string): Promise<void>;
    revokeCaptainRoleIfNoLongerCaptain(playerId: string): Promise<void>;
  };

  function makeService(opts: {
    rolesRepo: Record<string, jest.Mock>;
    findByCaptainId: jest.Mock;
  }): CaptainRoleSurface {
    const dataSource = {
      getRepository: jest.fn().mockReturnValue(opts.rolesRepo),
    } as unknown as DataSource;
    const teamsRepo = {
      findByCaptainId: opts.findByCaptainId,
    } as unknown as TeamsRepository;

    const service = new TeamsService(
      teamsRepo,
      null as never,
      null as never,
      dataSource,
      null as never,
      null as never,
      new ChatAccessEvents(),
    );
    return service as unknown as CaptainRoleSurface;
  }

  describe('grantCaptainRole', () => {
    it('creates a Captain role when the player has none', async () => {
      const rolesRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        create: jest.fn().mockImplementation((x: any) => x),
        save: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn(),
      };
      const service = makeService({
        rolesRepo,
        findByCaptainId: jest.fn(),
      });

      await service.grantCaptainRole('player-1');

      expect(rolesRepo.save).toHaveBeenCalledTimes(1);
      expect(rolesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: Role.CAPTAIN, isAdminRole: false }),
      );
    });

    it('is idempotent when the player already has the Captain role', async () => {
      const rolesRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'r1', name: Role.CAPTAIN }),
        create: jest.fn(),
        save: jest.fn(),
        remove: jest.fn(),
      };
      const service = makeService({
        rolesRepo,
        findByCaptainId: jest.fn(),
      });

      await service.grantCaptainRole('player-1');

      expect(rolesRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('revokeCaptainRoleIfNoLongerCaptain', () => {
    it('removes the Captain role when the player captains no active team', async () => {
      const role = { id: 'r1', name: Role.CAPTAIN };
      const rolesRepo = {
        findOne: jest.fn().mockResolvedValue(role),
        create: jest.fn(),
        save: jest.fn(),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      const service = makeService({
        rolesRepo,
        findByCaptainId: jest.fn().mockResolvedValue([]),
      });

      await service.revokeCaptainRoleIfNoLongerCaptain('player-1');

      expect(rolesRepo.remove).toHaveBeenCalledWith(role);
    });

    it('keeps the Captain role when the player still captains another active team', async () => {
      const rolesRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'r1', name: Role.CAPTAIN }),
        create: jest.fn(),
        save: jest.fn(),
        remove: jest.fn(),
      };
      const service = makeService({
        rolesRepo,
        findByCaptainId: jest
          .fn()
          .mockResolvedValue([{ id: 'team-2' } as Team]),
      });

      await service.revokeCaptainRoleIfNoLongerCaptain('player-1');

      expect(rolesRepo.remove).not.toHaveBeenCalled();
    });
  });
});
