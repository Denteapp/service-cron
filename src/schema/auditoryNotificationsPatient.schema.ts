import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AuditoryNotificationsPatientDocument = AuditoryNotificationsPatient & Document;

@Schema({ timestamps: true, collection: 'auditorynotificationspatients' })
export class AuditoryNotificationsPatient {
  @Prop({ type: Types.ObjectId, ref: 'Patient', required: true })
  patientId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MedicalClinic', required: true })
  medicalClinic: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Branch' })
  branch?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  user?: Types.ObjectId;

  @Prop({ required: true })
  reason: string;

  @Prop({
    type: String,
    enum: ['reminder', 'informative', 'alert', 'confirmation', 'cancellation', 'reschedule', 'other'],
    required: true,
  })
  notificationType: string;

  @Prop({ type: String, enum: ['email', 'whatsapp', 'sms', 'other'], required: true })
  channel: string;

  @Prop({ required: true })
  message: string;

  @Prop({ type: String, enum: ['pendiente', 'enviado', 'entregado', 'leido', 'fallido'], default: 'pendiente' })
  status: string;

  @Prop({ type: Date, default: () => new Date() })
  sentAt: Date;

  @Prop({ type: Date })
  deliveredAt?: Date; // Cuándo el mensaje fue entregado (webhook status: delivered)

  @Prop({ type: Date })
  readAt?: Date; // Cuándo el mensaje fue leído (webhook status: read)

  @Prop()
  response?: string;

  @Prop({ index: true })
  externalId?: string;

  @Prop({ type: String, enum: ['resend', 'meta_whatsapp', 'whatsapp_web', 'other'], default: 'resend' })
  provider: string;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop()
  lastRetryAt?: Date;

  @Prop({ type: Object })
  errorDetails?: { code?: string; message?: string; providerResponse?: any };

  @Prop()
  templateId?: string;

  @Prop({ default: 'es' })
  language: string;

  @Prop({ type: String, enum: ['low', 'normal', 'high'], default: 'normal' })
  priority: string;

  @Prop()
  expirationDate?: Date;

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const AuditoryNotificationsPatientSchema = SchemaFactory.createForClass(AuditoryNotificationsPatient);

AuditoryNotificationsPatientSchema.index({ medicalClinic: 1, sentAt: -1 });
AuditoryNotificationsPatientSchema.index({ medicalClinic: 1, branch: 1 });
// Índice para externalId ya definido en @Prop({ index: true }) línea 52
