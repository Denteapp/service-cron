import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import e from 'express';
import { Document, Types } from 'mongoose';

export type PaymentDocument = Payment & Document;

@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'MedicalClinic', required: true })
  medicalClinic: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  user: Types.ObjectId;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  transactionID: string;

  @Prop({ required: false })
  bankName: string;

  @Prop({ required: true })
  paymentState: number; // 0 = pendiente, 1 = pagado

  @Prop({ required: false })
  externalReference: string;

  @Prop({ required: false })
  holderName: string;

  @Prop()
  recipientImg?: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: false })
  paymentMethod: string;

  @Prop({ required: true })
  last4Digits: string;

  @Prop()
  transferDate?: string;
  @Prop()
  createdAt?: Date;

  @Prop()
  period?: string;
  //-------------------- Campos para la factura automatica --------------------
  @Prop({ default: false })
  isAutomatic: boolean;

  @Prop({ default: 'Sistema denteapp' })
  generatedBy: string;

  @Prop({ type: Date, default: () => new Date() })
  issuedDate: Date;

  @Prop()
  billingCycle: string; // Ej. "Junio 2025"

  @Prop({
    default: 'Factura generada automáticamente, pendiente de pago',
  })
  displayStatus: string;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

export enum PaymentState {
  PENDING = 0,
  PAID = 1,
  CANCELLED = 2,
  FAIL = 3,
  GENERATED = 4,
}

export enum canGenerateInvoiceCode {
  PERIOD_EXISTS = 'PERIOD_EXISTS',
  PREVIOUS_MONTH_REQUIRED = 'PREVIOUS_MONTH_REQUIRED',
  MAX_UNPAID_REACHED = 'MAX_UNPAID_REACHED',
  CAN_GENERATE = 'CAN_GENERATE',
}