import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DiscordConnectorService } from '../../connectors/discord/discord-connector.service';
import { toVerificationRequestView } from '../../db/mappers/verification-request.mapper';
import { Dota2Service } from '../../dota2/dota2.service';
import { PlayerRepository } from '../../repos/player.repository';
import { TeamRepository } from '../../repos/team.repository';
import { RequestRepository } from '../../repos/verification-request.repository';
import { SlotRepository } from '../../repos/verification-slot.repository';
import type {
  VerificationRequest,
  VerificationRequestView,
} from '../../types/entities/verification/request';
import { VerificationRequestStatus } from '../../types/enums/verification/VerificationRequestStatus';
import { VerificationSlotStatus } from '../../types/enums/verification/VerificationSlotStatus';
import { VerificationType } from '../../types/enums/verification/VerificationType';
import {
  ESTABLISHED_TEAM_VERIFIED_COUNT,
  VERIFICATION_REBLOCK_MS,
  VERIFICATION_VOICE_ROLE_ID,
  utcDateRange,
} from './verification.constants';

export interface CreateRequestInput {
  slotId: string;
  playerIds: string[];
}

export interface CompleteRequestInput {
  results: { playerId: string; mmr: number }[];
}

/**
 * Captain-facing booking flow: a captain books a free slot to verify players.
 * Enforces the two-tier player-count rule and derives the request type, then
 * atomically books the slot. Also owns slot deletion (since deleting a booked
 * slot cancels its request).
 */
@Injectable()
export class VerificationRequestService {
  constructor(
    private readonly requestRepo: RequestRepository,
    private readonly slotRepo: SlotRepository,
    private readonly teamRepo: TeamRepository,
    private readonly playerRepo: PlayerRepository,
    private readonly dota2: Dota2Service,
    private readonly discord: DiscordConnectorService,
  ) {}

  async createRequest(
    captainPlayerId: string,
    input: CreateRequestInput,
  ): Promise<VerificationRequestView> {
    const playerIds = [...new Set(input.playerIds)];
    if (playerIds.length === 0) {
      throw new BadRequestException('At least one player is required');
    }

    const team = await this.teamRepo.findCaptainedTeam(captainPlayerId);
    if (!team) {
      throw new ForbiddenException(
        'Only a team captain can request verification',
      );
    }

    // Re-verification cooldown set when an admin cancelled an in-progress request.
    if (
      team.verificationBlockedUntil &&
      new Date() < team.verificationBlockedUntil
    ) {
      throw new ForbiddenException('Повторна верифікація тимчасово заборонена');
    }

    const slot = await this.slotRepo.findById(input.slotId);
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot.status !== VerificationSlotStatus.Free) {
      throw new ConflictException('Slot is not free');
    }

    const players = await this.playerRepo.findByIds(playerIds);
    if (players.length !== playerIds.length) {
      throw new BadRequestException('One or more players do not exist');
    }

    // Two-tier rule: a team with <3 verified members must bring at least 3
    // players for its (first) verification; an established team may bring 1.
    const verifiedCount = await this.teamRepo.countVerifiedMainPlayers(team.id);
    const established = verifiedCount >= ESTABLISHED_TEAM_VERIFIED_COUNT;
    if (!established && playerIds.length < ESTABLISHED_TEAM_VERIFIED_COUNT) {
      throw new BadRequestException(
        `First verification requires at least ${ESTABLISHED_TEAM_VERIFIED_COUNT} players`,
      );
    }

    // Already-verified players get the MMR-update flow; anyone unverified makes
    // it a FIRST verification.
    const allVerified = players.every((p) => p.verifiedAt != null);
    const type = allVerified
      ? VerificationType.MmrUpdate
      : VerificationType.First;

    const request = await this.requestRepo.createBooking({
      slotId: input.slotId,
      teamId: team.id,
      type,
      createdByPlayerId: captainPlayerId,
      playerIds,
    });

    // TODO: notify the captain + players that the booking was created
    return this.toView(request);
  }

  /** Player-facing: every verification request the player takes part in, newest first. */
  async listForPlayer(playerId: string): Promise<VerificationRequestView[]> {
    const requests = await this.requestRepo.findByPlayerId(playerId);
    return Promise.all(requests.map((request) => this.toView(request)));
  }

  /** Admin list: every request whose slot falls in the inclusive `from`..`to` UTC day range (default today). */
  async listInRange(
    from?: string,
    to?: string,
  ): Promise<VerificationRequestView[]> {
    const { start, end } = utcDateRange(from, to);
    const requests = await this.requestRepo.findInRange(start, end);
    if (requests.length === 0) return [];

    const teams = await this.teamRepo.findFullByIds(
      requests.map((r) => r.teamId),
    );
    const slots = await this.slotRepo.findInRange(start, end);
    const slotById = new Map(slots.map((s) => [s.id, s]));

    return requests.map((request) =>
      toVerificationRequestView(request, {
        team: teams.get(request.teamId) ?? null,
        slot: slotById.get(request.slotId) ?? null,
      }),
    );
  }

  /** Admin takes a pending request into processing. */
  async process(id: string): Promise<VerificationRequestView> {
    const request = await this.requestRepo.findById(id);
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== VerificationRequestStatus.Pending) {
      throw new ConflictException(
        `Only pending requests can be processed (is ${request.status})`,
      );
    }
    await this.requestRepo.setStatus(id, VerificationRequestStatus.Processing);
    // Open temporary Discord voice access for the captain + players being verified.
    const discordIds = await this.verificationDiscordIds(request);
    void this.discord.grantRole(discordIds, VERIFICATION_VOICE_ROLE_ID);
    return this.toView({
      ...request,
      status: VerificationRequestStatus.Processing,
    });
  }

  /**
   * Admin completes a request: writes each player's resulting MMR (and, for a
   * FIRST verification, stamps `verifiedAt` + marks the team verified) in one
   * transaction across the v2 request rows and the v1-owned player/team tables.
   */
  async complete(
    id: string,
    input: CompleteRequestInput,
  ): Promise<VerificationRequestView> {
    const request = await this.requestRepo.findById(id);
    if (!request) throw new NotFoundException('Request not found');
    if (
      request.status === VerificationRequestStatus.Completed ||
      request.status === VerificationRequestStatus.Cancelled
    ) {
      throw new ConflictException(`Request is already ${request.status}`);
    }

    const expected = new Set(request.players.map((p) => p.player.id));
    const given = new Set(input.results.map((r) => r.playerId));
    if (given.size !== input.results.length) {
      throw new BadRequestException('Duplicate player in results');
    }
    if (
      given.size !== expected.size ||
      ![...given].every((p) => expected.has(p))
    ) {
      throw new BadRequestException(
        'Results must cover exactly the request players',
      );
    }

    const markVerified = request.type === VerificationType.First;
    await this.requestRepo.transaction(async (m) => {
      await this.requestRepo.setPlayerResults(id, input.results, m);
      await this.playerRepo.applyResults(input.results, markVerified, m);
      if (markVerified) {
        await this.teamRepo.markVerified(request.teamId, m);
      }
      await this.requestRepo.setStatus(
        id,
        VerificationRequestStatus.Completed,
        m,
      );
    });

    // A FIRST verification just marked the team verified and may have stamped the
    // captain's `verifiedAt` in the same transaction — read the captain's state
    // post-commit and add them to the Dota2 league admin list when eligible.
    // Fire-and-forget: a Dota2 failure must not fail the completion response.
    if (markVerified) {
      const captain = await this.teamRepo.findCaptainLeagueState(
        request.teamId,
      );
      if (captain?.isVerified && captain.steamId && captain.verifiedAt) {
        void this.dota2.addLeagueAdmin(captain.steamId);
      }
    }

    // Close the temporary verification voice access — the session is over.
    const discordIds = await this.verificationDiscordIds(request);
    void this.discord.revokeRole(discordIds, VERIFICATION_VOICE_ROLE_ID);
    const updated = await this.requestRepo.findById(id);
    return this.toView(updated ?? request);
  }

  /**
   * Admin cancels a request. Behaviour depends on its current status:
   * - pending: not yet picked up, so the request and its slot are hard-deleted.
   * - processing: the request is cancelled, its slot freed for rebooking, and the
   *   team put under a re-verification cooldown (blocks new bookings for a window).
   * - completed: rejected; - cancelled: idempotent no-op.
   */
  async cancel(id: string): Promise<VerificationRequestView> {
    const request = await this.requestRepo.findById(id);
    if (!request) throw new NotFoundException('Request not found');
    if (request.status === VerificationRequestStatus.Completed) {
      throw new ConflictException('Completed requests cannot be cancelled');
    }
    if (request.status === VerificationRequestStatus.Cancelled) {
      return this.toView(request);
    }

    if (request.status === VerificationRequestStatus.Pending) {
      // Capture the view before deletion (the slot row is about to disappear).
      const view = await this.toView(request);
      await this.requestRepo.transaction(async (m) => {
        await this.requestRepo.deleteById(id, m);
        await this.slotRepo.remove(request.slotId, m);
      });
      // TODO: notify the captain + players that the request was cancelled
      return { ...view, status: VerificationRequestStatus.Cancelled };
    }

    // Processing: cancel, free the slot, and start the re-verification cooldown.
    // No Dota2 league-admin revoke is owed here: cancelling an in-progress request
    // does not un-verify an already-verified team (it never touches team.isVerified),
    // so the captain's admin status is unchanged. Revokes fire only on a real
    // verified→unverified transition (unverifyTeam / TeamsService.update / disband).
    const blockedUntil = new Date(Date.now() + VERIFICATION_REBLOCK_MS);
    await this.requestRepo.transaction(async (m) => {
      await this.requestRepo.setStatus(
        id,
        VerificationRequestStatus.Cancelled,
        m,
      );
      await this.slotRepo.setStatus(
        request.slotId,
        VerificationSlotStatus.Free,
        m,
      );
      await this.teamRepo.setVerificationBlock(request.teamId, blockedUntil, m);
    });
    // Close the temporary verification voice access opened at processing time.
    const discordIds = await this.verificationDiscordIds(request);
    void this.discord.revokeRole(discordIds, VERIFICATION_VOICE_ROLE_ID);
    return this.toView({
      ...request,
      status: VerificationRequestStatus.Cancelled,
    });
  }

  /** Free slot → removed; booked slot → its request is cancelled and freed. */
  async deleteSlot(slotId: string): Promise<void> {
    const slot = await this.slotRepo.findById(slotId);
    if (!slot) throw new NotFoundException('Slot not found');

    if (slot.status === VerificationSlotStatus.Free) {
      await this.slotRepo.remove(slotId);
      return;
    }

    const request = await this.requestRepo.findBySlotId(slotId);
    if (request && request.status !== VerificationRequestStatus.Completed) {
      // Capture the pre-cancel status: setStatus updates the DB by id, not this
      // in-memory object, so request.status still reflects the current status.
      const wasProcessing =
        request.status === VerificationRequestStatus.Processing;
      await this.requestRepo.setStatus(
        request.id,
        VerificationRequestStatus.Cancelled,
      );
      // A processing request had the temporary voice-access role granted at
      // process() time — remove it now that an admin cancelled it via the slot.
      if (wasProcessing) {
        const discordIds = await this.verificationDiscordIds(request);
        void this.discord.revokeRole(discordIds, VERIFICATION_VOICE_ROLE_ID);
      }
      // TODO: notify the captain + players that the slot was cancelled by an admin
    }
    await this.slotRepo.setStatus(slotId, VerificationSlotStatus.Cancelled);
  }

  /**
   * Discord IDs of the captain (createdByPlayerId) plus every player on the
   * request, deduped, with unlinked players dropped. Used to grant/revoke the
   * temporary verification voice-access role.
   */
  private async verificationDiscordIds(
    request: VerificationRequest,
  ): Promise<string[]> {
    const playerIds = new Set<string>([
      request.createdByPlayerId,
      ...request.players.map((p) => p.player.id),
    ]);
    const rows = await this.playerRepo.findDiscordIdsByIds([...playerIds]);
    return rows
      .map((r) => r.discordId)
      .filter((d): d is string => d != null && d !== '');
  }

  private async toView(
    request: VerificationRequest,
  ): Promise<VerificationRequestView> {
    const team = await this.teamRepo.findFullById(request.teamId);
    const slot = await this.slotRepo.findById(request.slotId);
    return toVerificationRequestView(request, { team, slot });
  }
}
