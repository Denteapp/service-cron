import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';
import { Appointment, AppointmentSchema } from 'src/schema/appointment.schema';
import { Patient, PatientSchema } from 'src/schema/patient.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { MedicalClinic, MedicalClinicSchema } from 'src/schema/medicalClinic.schema';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: MedicalClinic.name, schema: MedicalClinicSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [SchedulerService],
})
export class SchedulerModule { }
