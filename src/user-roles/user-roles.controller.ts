import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRolesService } from './user-roles.service';
import { CreateUserRoleDto } from './dto/create-user-role.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UserRoleResponseDto } from './dto/user-role-response.dto';
import { OwnUserRoleAssignmentGuard } from './guards/own-user-role-assignment.guard';

type AuthedRequest = Request & { user: { playerId: string } };

@ApiTags('user-roles')
@Controller('user-roles')
export class UserRolesController {
  constructor(private readonly userRolesService: UserRolesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: UserRoleResponseDto })
  create(@Req() req: AuthedRequest, @Body() body: CreateUserRoleDto) {
    return this.userRolesService.create(req.user.playerId, body);
  }

  @Get()
  @ApiOkResponse({ type: UserRoleResponseDto, isArray: true })
  findAll() {
    return this.userRolesService.findAll();
  }

  @Get(':id')
  @ApiOkResponse({ type: UserRoleResponseDto })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.userRolesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, OwnUserRoleAssignmentGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserRoleResponseDto })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateUserRoleDto,
  ) {
    return this.userRolesService.update(id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, OwnUserRoleAssignmentGuard)
  @ApiBearerAuth()
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.userRolesService.remove(id);
  }
}
