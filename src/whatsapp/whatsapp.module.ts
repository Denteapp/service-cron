import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { Appointment, AppointmentSchema } from 'src/schema/appointment.schema';
import { AuditoryNotificationsPatient, AuditoryNotificationsPatientSchema } from 'src/schema/auditoryNotificationsPatient.schema';
import { User, UserSchema } from 'src/schema/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: AuditoryNotificationsPatient.name, schema: AuditoryNotificationsPatientSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}



