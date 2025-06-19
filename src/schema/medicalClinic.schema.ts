import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { UserDocument } from './user.schema';


export type MedicalClinicDocument = MedicalClinic & Document & { _id: Types.ObjectId };

export type MedicalClinicWithAdmin = MedicalClinicDocument & {
  adminEmails: string[];
  adminNames: string[];
  email?: string; // porque vas a sobreescribirlo
};
@Schema({ timestamps: true })


export class MedicalClinic extends Document {

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }] })
  users: Types.ObjectId[] | UserDocument[];
 

  @Prop({ required: true })
  medicalClinicName: string;

  @Prop({ required: true })
  expiredSubsDate: Date;

  @Prop({ required: true })
  paymentState: string;

  @Prop({ required: true })
  licenceType: string;

  @Prop({ required: true })
  isActive: boolean;

  @Prop({ required: true })
  plan: number;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  country: string;

  @Prop()
  nit?: string;

  @Prop()
  avatar?: string;

  @Prop()
  address?: string;

  @Prop()
  phone?: string;

  @Prop()
  email?: string;

  @Prop({ required: true, default: 1 })
  licenceUser: number;
}

export const MedicalClinicSchema = SchemaFactory.createForClass(MedicalClinic);
