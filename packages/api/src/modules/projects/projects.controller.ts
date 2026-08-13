import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
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
