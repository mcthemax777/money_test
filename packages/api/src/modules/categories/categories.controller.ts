import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { CategoryDto } from '@money/types';

@ApiTags('Categories')
@Controller('categories')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '카테고리 생성' })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CategoryDto.CreateRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.categoriesService.createCategory(req.user.id, dto, projectId || (req.body as any)?.projectId);
  }

  @Get()
  @ApiOperation({ summary: '카테고리 목록 (계층 구조)' })
  list(@Request() req: AuthenticatedRequest, @Query('type') type?: 'income' | 'expense', @Query('projectId') projectId?: string) {
    return this.categoriesService.getCategories(req.user.id, type, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: '카테고리 상세' })
  getById(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.categoriesService.getCategoryById(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '카테고리 수정' })
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CategoryDto.UpdateRequest,
  ) {
    return this.categoriesService.updateCategory(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '카테고리 삭제' })
  delete(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.categoriesService.deleteCategory(id, req.user.id);
  }
}
