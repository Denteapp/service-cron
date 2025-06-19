import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PatientDocument = Patient & Document;

@Schema()
export class CommentAdmin {
  @Prop()
  comment: string;

  @Prop()
  doctor: string;

  @Prop()
  dateRegister: string;

  @Prop()
  visible: boolean;
}

@Schema({ timestamps: true })
export class Patient {

  @Prop({ type: [CommentAdmin], default: [] })
  commentAdminPatient: CommentAdmin[];

  @Prop()
  numberID: string;

  @Prop()
  documentType: string;

  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop()
  phoneNumber: string;

  @Prop()
  email: string;

  @Prop()
  department: string;

  @Prop()
  city: string;

  @Prop()
  country: string;

  @Prop()
  gender: string;

  @Prop()
  dateBorn: string;

  @Prop()
  address: string;

  @Prop()
  commentPatient: string;

  @Prop()
  avatar: string;
  
  @Prop()
  nameReference: string;

  @Prop()
  phoneReference: string;

  @Prop()
  maritalStatus: string;

  @Prop()
  placeWork: string;

  @Prop()
  createdDate: Date;

  @Prop({ required: true })
  searchName: string;

}

export const PatientSchema = SchemaFactory.createForClass(Patient);

// Índice compuesto para búsqueda
PatientSchema.index({ searchName: 'text', medicalClinic: 1 });
