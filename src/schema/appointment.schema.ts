import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AppointmentDocument = Appointment & Document;

@Schema({ timestamps: true })
export class Appointment {
  @Prop({ type: Types.ObjectId, ref: 'User' })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MedicalClinic' })
  medicalClinic: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Patient' })
  patient: Types.ObjectId;

  @Prop({ required: true })
  patientName: string;

  @Prop({ required: true, type: Date })
  start: Date;

  @Prop({ required: true })
  patientEmail: string;

  @Prop({ required: true })
  patientPhone: string;

  @Prop({ required: true, type: Boolean })
  notificationEmail: boolean;

  @Prop({ required: true, type: Boolean })
  notificationWhatsapp: boolean;

  @Prop({ required: true })
  appointmentDate: Date;

  @Prop()
  reason?: string;

  @Prop({ default: 'pending' })
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
}

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);

// Índices sugeridos
AppointmentSchema.index({ medicalClinic: 1, start: 1 });
AppointmentSchema.index({ notificationEmail: 1 });
AppointmentSchema.index({ notificationWhatsapp: 1 });
AppointmentSchema.index({ appointmentDate: 1 });