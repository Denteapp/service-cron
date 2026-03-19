import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationLogDocument = NotificationLog & Document;

@Schema({ timestamps: true })
export class NotificationLog extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Appointment', required: true, index: true })
  appointment: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Patient', required: true })
  patient: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MedicalClinic', required: true })
  medicalClinic: Types.ObjectId;

  @Prop({ 
    type: String, 
    enum: ['reminder_24h', 'reminder_4h', 'reminder_2h', 'confirmation', 'cancellation'],
    required: true 
  })
  notificationType: string;

  @Prop({ type: String, enum: ['email', 'whatsapp', 'both'], required: true })
  channel: string;

  @Prop({ type: Boolean, default: true })
  success: boolean;

  @Prop()
  error?: string;

  @Prop({ default: 1 })
  attempts: number;

  @Prop()
  phoneNumber?: string;

  @Prop()
  email?: string;

  @Prop({ type: Date, default: () => new Date() })
  sentAt: Date;
}

export const NotificationLogSchema = SchemaFactory.createForClass(NotificationLog);

// Índice compuesto único: Previene duplicados a nivel de BD
// Una cita solo puede tener un log por tipo de notificación
NotificationLogSchema.index(
  { appointment: 1, notificationType: 1 }, 
  { unique: true }
);

// Índices adicionales para queries de análisis
NotificationLogSchema.index({ medicalClinic: 1, sentAt: -1 });
NotificationLogSchema.index({ notificationType: 1, success: 1 });
