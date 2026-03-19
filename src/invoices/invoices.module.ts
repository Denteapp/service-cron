import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvoicesService } from './invoices.service';
import { MedicalClinic, MedicalClinicSchema } from '../schema/medicalClinic.schema';
import { Payment, PaymentSchema } from '../schema/payment.schema';
import { Subscription, SubscriptionSchema } from '../schema/subscription.schema';
import { NotificationService } from '../notification/notification.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MedicalClinic.name, schema: MedicalClinicSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
  ],
  providers: [InvoicesService, NotificationService],
  exports: [InvoicesService],
})
export class InvoicesModule {}