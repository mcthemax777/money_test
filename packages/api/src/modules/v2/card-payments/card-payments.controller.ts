import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import { CardPaymentsService } from './card-payments.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('v2/card-payments')
@UseGuards(AuthGuard('jwt'))
export class CardPaymentsController {
  constructor(private readonly cardPaymentsService: CardPaymentsService) {}

  @Get('pending')
  async getPendingPayments(
    @Req() req: any,
    @Query('cardId') cardId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.cardPaymentsService.getPendingPayments(req.user.id, {
      cardId,
      projectId,
    });
  }

  @Get(':paymentId')
  async getPaymentDetail(
    @Req() req: any,
    @Param('paymentId') paymentId: string,
  ) {
    return this.cardPaymentsService.getPaymentDetail(paymentId, req.user.id);
  }

  @Post(':paymentId/pay')
  async payCardPayment(
    @Req() req: any,
    @Param('paymentId') paymentId: string,
    @Body() dto: { amount: number; transactionDate?: string },
  ) {
    return this.cardPaymentsService.payCardPayment(paymentId, req.user.id, dto);
  }

  @Delete(':transactionId/cancel')
  async cancelPayment(
    @Req() req: any,
    @Param('transactionId') transactionId: string,
  ) {
    return this.cardPaymentsService.cancelPayment(transactionId, req.user.id);
  }

  @Post('auto-pay')
  @HttpCode(200)
  async autoPayAllPending(
    @Req() req: any,
    @Query('projectId') projectId?: string,
  ) {
    return this.cardPaymentsService.autoPayAllPending(req.user.id, projectId);
  }
}
