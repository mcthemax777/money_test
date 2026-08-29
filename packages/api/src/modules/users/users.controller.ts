import { Controller, Get, Patch, Body, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedRequest } from '../../common/authenticated-request';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: '사용자 정보 조회' })
  getProfile(@Request() req: AuthenticatedRequest) {
    return this.usersService.getProfile(req.user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: '사용자 정보 수정 (이름, 사진, 화면 언어)' })
  updateProfile(
    @Request() req: AuthenticatedRequest,
    @Body() data: { name?: string; avatar?: string; locale?: string },
  ) {
    return this.usersService.updateProfile(req.user.id, data);
  }

  @Patch('me/default-project')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '기본 프로젝트 변경' })
  setDefaultProject(@Request() req: AuthenticatedRequest, @Body() data: { projectId: string }) {
    return this.usersService.setDefaultProject(req.user.id, data.projectId);
  }
}
