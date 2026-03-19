import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AppointmentDocument = Appointment & Document;

@Schema({ timestamps: true })
export class Appointment {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MedicalClinic', required: true })
  medicalClinic: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Patient' })
  patient: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Branch', required: true })
  branch: Types.ObjectId;

  @Prop()
  procedure?: string;

  @Prop()
  duration?: string;

  @Prop()
  date?: string;

  @Prop({ required: true, type: Date })
  start: Date;

  @Prop()
  end?: Date;

  @Prop()
  time?: string;

  @Prop({ required: true, type: Boolean })
  notificationEmail: boolean;

  @Prop({ required: true, type: Boolean })
  notificationWhatsapp: boolean;

  @Prop({ default: 'Sin Confirmar' })
  status: 'Sin Confirmar' | 'Confirmada' | 'Cancelada' | 'Reprogramar' | 'completed';

  @Prop({ type: String, enum: ['whatsapp', 'email', null], default: null })
  confirmationChannel?: string;

  @Prop({
    type: [
      {
        type: { type: String, enum: ['reminder_24h', 'reminder_4h', 'reminder_2h'] },
        status: { type: String, enum: ['enviado', 'entregado', 'leido', 'fallido', 'confirmado', 'cancelado'] }, // Sincronizado con auditoryNotificationsPatient
        sentAt: { type: Date },
        messageId: { type: String }, // ID del mensaje de WhatsApp para tracking
        deliveredAt: { type: Date }, // Cuándo fue entregado el mensaje
        readAt: { type: Date }, // Cuándo fue leído el mensaje
        confirmedAt: { type: Date }, // Cuándo se confirmó usando este mensaje
        cancelledAt: { type: Date }, // Cuándo se canceló usando este mensaje
      },
    ],
    default: [],
  })
  notificationsSent: { 
    type: string; 
    status: 'enviado' | 'entregado' | 'leido' | 'fallido' | 'confirmado' | 'cancelado'; 
    sentAt: Date; 
    messageId?: string; 
    deliveredAt?: Date; 
    readAt?: Date; 
    confirmedAt?: Date;
    cancelledAt?: Date;
  }[];
}

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);

AppointmentSchema.index({ medicalClinic: 1, branch: 1 });
AppointmentSchema.index({ medicalClinic: 1, start: 1 });
AppointmentSchema.index({ notificationEmail: 1 });
AppointmentSchema.index({ notificationWhatsapp: 1 });
AppointmentSchema.index({ status: 1, start: 1 });
AppointmentSchema.index({ 'notificationsSent.type': 1 });