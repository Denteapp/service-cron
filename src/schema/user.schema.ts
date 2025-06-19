import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ type: Types.ObjectId, ref: 'MedicalClinic', required: true })
  medicalClinic: Types.ObjectId;

  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  phoneNumber: string;

  @Prop({ required: true })
  specialty: string;

  @Prop({ required: true })
  department: string;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  gender: string;

  @Prop()
  dateBorn: Date;

  @Prop({ default: Date.now, required: true })
  createdDate: Date;

  @Prop()
  password: string;

  @Prop()
  isActive: boolean;

  @Prop({
    type: String,
    enum: ['admin', 'user', 'secreatary'],
    default: 'admin',
    required: true,
  })
  role: 'admin' | 'user' | 'secreatary';
}

export const UserSchema = SchemaFactory.createForClass(User);

// Opcional: sobrescribir toJSON si quieres cambiar _id -> id
UserSchema.method('toJSON', function (): Record<string, any> {
  const { __v, _id, ...object } = this.toObject();
  return { ...object, id: _id };
});
