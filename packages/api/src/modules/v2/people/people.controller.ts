import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PeopleService } from './people.service';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { PersonDto } from '@money/types';

@ApiTags('People (v2)')
@Controller('v2/people')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '사람 등록' })
  create(@Request() req: AuthenticatedRequest, @Body() dto: PersonDto.CreateRequest) {
    return this.peopleService.createPerson(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '사람 목록' })
  list(@Request() req: AuthenticatedRequest) {
    return this.peopleService.getPeople(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '사람 상세' })
  getById(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.peopleService.getPersonById(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '사람 수정' })
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: PersonDto.UpdateRequest,
  ) {
    return this.peopleService.updatePerson(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '사람 삭제' })
  delete(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.peopleService.deletePerson(id, req.user.id);
  }
}
