import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AcceptJoinRequestDto,
  ApplyToTeamPostDto,
  CreateTeamInviteRequestDto,
  CreateTeamPostDto,
  JoinRequestDto,
  PlayerListingDto,
  PlayerListingsPageDto,
  PlayerListingsQueryDto,
  RecruitmentMeDto,
  TeamPostDto,
  TeamPostsPageDto,
  TeamPostsQueryDto,
  UpdateTeamPostDto,
  UpsertPlayerListingDto,
} from './dto/recruitment.dto';
import { RecruitmentService } from './recruitment.service';

type AuthedRequest = Request & { user: { playerId: string } };

@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('recruitment')
export class RecruitmentController {
  constructor(private readonly recruitment: RecruitmentService) {}

  @Get('me')
  @ApiOperation({
    summary: 'My recruitment state',
    description:
      'My listing, daily limits left, and the teams I captain / coach with their open post.',
  })
  @ApiOkResponse({ type: RecruitmentMeDto })
  me(@Req() req: AuthedRequest): Promise<RecruitmentMeDto> {
    return this.recruitment.me(req.user.playerId);
  }

  // ── team posts ───────────────────────────────────────────────────────────

  @Get('teams')
  @ApiOperation({
    summary: 'Open team posts',
    description: 'VIP captains first, then newest. Paged with limit / offset.',
  })
  @ApiOkResponse({ type: TeamPostsPageDto })
  listTeamPosts(
    @Query() query: TeamPostsQueryDto,
    @Req() req: AuthedRequest,
  ): Promise<TeamPostsPageDto> {
    return this.recruitment.listTeamPosts(req.user.playerId, query);
  }

  @Post('teams')
  @ApiOperation({
    summary: 'Open a team post (captain / coach / admin)',
    description: '409 when the team already has an open post.',
  })
  @ApiOkResponse({ type: TeamPostDto })
  createTeamPost(
    @Body() body: CreateTeamPostDto,
    @Req() req: AuthedRequest,
  ): Promise<TeamPostDto> {
    return this.recruitment.createTeamPost(req.user.playerId, body);
  }

  @Patch('teams/:id')
  @ApiOperation({ summary: 'Edit an open team post' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: TeamPostDto })
  updateTeamPost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTeamPostDto,
    @Req() req: AuthedRequest,
  ): Promise<TeamPostDto> {
    return this.recruitment.updateTeamPost(req.user.playerId, id, body);
  }

  @Delete('teams/:id')
  @ApiOperation({
    summary: 'Close a team post (managers, admin moderation)',
    description: 'Its pending applications are cancelled.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: TeamPostDto })
  closeTeamPost(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<TeamPostDto> {
    return this.recruitment.closeTeamPost(req.user.playerId, id);
  }

  @Post('teams/:id/applications')
  @ApiOperation({
    summary: 'Apply to a team post',
    description:
      'Needs a verified, Steam-linked, team-less player whose MMR fits the range and who plays one of the positions. 429 past the daily limit (VIP unlimited).',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: TeamPostDto })
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApplyToTeamPostDto,
    @Req() req: AuthedRequest,
  ): Promise<TeamPostDto> {
    return this.recruitment.apply(req.user.playerId, id, body);
  }

  // ── player listings ──────────────────────────────────────────────────────

  @Get('players')
  @ApiOperation({
    summary: 'Players looking for a team',
    description: 'VIP players first, then newest. Paged with limit / offset.',
  })
  @ApiOkResponse({ type: PlayerListingsPageDto })
  listPlayerListings(
    @Query() query: PlayerListingsQueryDto,
    @Req() req: AuthedRequest,
  ): Promise<PlayerListingsPageDto> {
    return this.recruitment.listPlayerListings(req.user.playerId, query);
  }

  @Put('players/me')
  @ApiOperation({
    summary: 'Publish / edit my "looking for a team" listing',
    description:
      'Needs a verified, Steam-linked, team-less player with positions.',
  })
  @ApiOkResponse({ type: PlayerListingDto })
  upsertMyListing(
    @Body() body: UpsertPlayerListingDto,
    @Req() req: AuthedRequest,
  ): Promise<PlayerListingDto> {
    return this.recruitment.upsertMyListing(req.user.playerId, body);
  }

  @Delete('players/me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove my listing' })
  @ApiNoContentResponse()
  deleteMyListing(@Req() req: AuthedRequest): Promise<void> {
    return this.recruitment.deleteMyListing(req.user.playerId);
  }

  @Delete('players/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a listing (author or admin)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiNoContentResponse()
  deleteListing(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    return this.recruitment.deleteListing(req.user.playerId, id);
  }

  // ── requests ─────────────────────────────────────────────────────────────

  @Post('invites')
  @ApiOperation({
    summary: 'Invite a team-less player (captain / coach / admin)',
    description:
      '429 past the daily team limit (unlimited for a VIP / admin sender).',
  })
  @ApiOkResponse({ type: JoinRequestDto })
  invite(
    @Body() body: CreateTeamInviteRequestDto,
    @Req() req: AuthedRequest,
  ): Promise<JoinRequestDto> {
    return this.recruitment.invite(req.user.playerId, body);
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'Application / invite details (participants only)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: JoinRequestDto })
  getRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<JoinRequestDto> {
    return this.recruitment.getRequest(req.user.playerId, id);
  }

  @Post('requests/:id/accept')
  @ApiOperation({
    summary: 'Accept: a manager an application, the invitee an invite',
    description:
      'The player joins the team right away; their other pending requests and listing are dropped.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: JoinRequestDto })
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AcceptJoinRequestDto,
    @Req() req: AuthedRequest,
  ): Promise<JoinRequestDto> {
    return this.recruitment.accept(req.user.playerId, id, body);
  }

  @Post('requests/:id/decline')
  @ApiOperation({
    summary: 'Decline: a manager an application, the invitee an invite',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: JoinRequestDto })
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<JoinRequestDto> {
    return this.recruitment.decline(req.user.playerId, id);
  }

  @Delete('requests/:id')
  @ApiOperation({
    summary: 'Withdraw: the applicant an application, a manager an invite',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: JoinRequestDto })
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<JoinRequestDto> {
    return this.recruitment.withdraw(req.user.playerId, id);
  }
}
