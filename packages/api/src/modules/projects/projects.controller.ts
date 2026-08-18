import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProject(@Request() req: any, @Body() body: { name: string; description?: string }) {
    return this.projectsService.createProject(req.user.id, body);
  }

  @Get()
  async getMyProjects(@Request() req: any) {
    return this.projectsService.getMyProjects(req.user.id);
  }

  // ===== 가입 요청 =====
  // 아래 구체 경로들은 :projectId 패턴보다 먼저 선언해야 선점되지 않는다.

  @Get('search')
  async findProjectByKey(@Query('key') key: string, @Request() req: any) {
    return this.projectsService.findProjectByKey(key, req.user.id);
  }

  @Get('join-requests/mine')
  async getMyJoinRequests(@Request() req: any) {
    return this.projectsService.getMyJoinRequests(req.user.id);
  }

  @Post('join-requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  async approveJoinRequest(
    @Param('requestId') requestId: string,
    @Body() body: { role?: 'editor' | 'viewer' },
    @Request() req: any,
  ) {
    return this.projectsService.approveJoinRequest(requestId, req.user.id, body?.role);
  }

  @Post('join-requests/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectJoinRequest(@Param('requestId') requestId: string, @Request() req: any) {
    return this.projectsService.rejectJoinRequest(requestId, req.user.id);
  }

  @Delete('join-requests/:requestId')
  @HttpCode(HttpStatus.OK)
  async cancelJoinRequest(@Param('requestId') requestId: string, @Request() req: any) {
    return this.projectsService.cancelJoinRequest(requestId, req.user.id);
  }

  @Post(':projectId/join-requests')
  @HttpCode(HttpStatus.CREATED)
  async requestToJoin(
    @Param('projectId') projectId: string,
    @Body() body: { message?: string },
    @Request() req: any,
  ) {
    return this.projectsService.requestToJoin(projectId, req.user.id, body?.message);
  }

  @Get(':projectId/join-requests')
  async getProjectJoinRequests(@Param('projectId') projectId: string, @Request() req: any) {
    return this.projectsService.getProjectJoinRequests(projectId, req.user.id);
  }

  @Get(':projectId/members')
  async getProjectMembers(@Param('projectId') projectId: string, @Request() req: any) {
    return this.projectsService.getProjectMembers(projectId, req.user.id);
  }

  @Post(':projectId/invitations/email')
  async sendEmailInvitation(
    @Param('projectId') projectId: string,
    @Body() body: { email: string; role: 'owner' | 'editor' | 'viewer' },
    @Request() req: any,
  ) {
    return this.projectsService.sendEmailInvitation(projectId, body.email, body.role, req.user.id);
  }

  @Post(':projectId/invitations/link')
  async generateInvitationLink(
    @Param('projectId') projectId: string,
    @Body() body: { role: 'owner' | 'editor' | 'viewer' },
    @Request() req: any,
  ) {
    return this.projectsService.generateInvitationLink(projectId, body.role, req.user.id);
  }

  @Get(':projectId/invitations/pending')
  async getProjectPendingInvitations(@Param('projectId') projectId: string, @Request() req: any) {
    return this.projectsService.getProjectPendingInvitations(projectId, req.user.id);
  }

  @Post('invitations/:invitationCode/accept')
  async acceptInvitation(@Param('invitationCode') invitationCode: string, @Request() req: any) {
    return this.projectsService.acceptInvitation(invitationCode, req.user.id);
  }

  @Post('invitations/:invitationCode/decline')
  async declineInvitation(@Param('invitationCode') invitationCode: string) {
    return this.projectsService.declineInvitation(invitationCode);
  }

  @Post(':projectId/leave')
  @HttpCode(HttpStatus.OK)
  async leaveProject(@Param('projectId') projectId: string, @Request() req: any) {
    return this.projectsService.leaveProject(projectId, req.user.id);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.OK)
  async deleteProject(@Param('projectId') projectId: string, @Request() req: any) {
    return this.projectsService.deleteProject(projectId, req.user.id);
  }
}
