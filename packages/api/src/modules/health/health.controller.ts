import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { SkipVersionCheck } from '../app-version/skip-version-check.decorator';

@ApiTags('Health')
@Controller('health')
@SkipVersionCheck()
export class HealthController {
  @Get()
  @ApiOkResponse({ description: '서버 상태 확인' })
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
