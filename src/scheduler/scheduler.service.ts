import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Appointment, AppointmentDocument } from 'src/schema/appointment.schema';
import { addDays, startOfDay, endOfDay } from 'date-fns';
import { Resend } from 'resend';  // Suponiendo que usas Resend para enviar correos
import { Patient } from 'src/schema/patient.schema';
import { User } from 'src/schema/user.schema'; // Importa el esquema de usuario
import { renderAppointmentReminderMJML } from './../utils/templates-appointment-reming.template';  // Importa la función
import { MedicalClinic } from 'src/schema/medicalClinic.schema'; // Add this import

type PopulatedAppointment = Appointment & {
  patient: Patient | Types.ObjectId;
  user: User | Types.ObjectId;
  medicalClinic: MedicalClinic | Types.ObjectId;
  _id: Types.ObjectId;
};

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly resend = new Resend('re_Gra27vCZ_jHqBkANeJViMvoqyc8GMuNqt');  // Inserta tu clave de API de Resend

  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
  ) { }

  // @Cron(CronExpression.EVERY_30_SECONDS) TODO: Descomentar para pruebas
  async notifyTomorrowAppointments() {
    // this.logger.log('🔔 Buscando citas para notificar del día siguiente...');

    const startOfTomorrow = startOfDay(addDays(new Date(), 1));
    const endOfTomorrow = endOfDay(addDays(new Date(), 1));

    const appointments = await this.appointmentModel.find({
      medicalClinic: new Types.ObjectId('6613754dbb593f4d49c218a4'),
      start: { $gte: startOfTomorrow, $lte: endOfTomorrow },
      $or: [{ notificationEmail: true }, { notificationWhatsapp: true }],
    })
      .populate({
        path: 'patient',
        select: 'firstName lastName phoneNumber email',
      })
      .populate({
        path: 'medicalClinic',
        select: 'avatar medicalClinicName address phone email',
      })
      .populate({
        path: 'user',
        select: 'firstName lastName email role',
      }) as unknown as PopulatedAppointment[];

    // this.logger.log(`📅 Citas encontradas para mañana: ${appointments.length}`);
    // this.logger.log(`📅 Citas encontradas para mañana: ${appointments}`);

    for (const appointment of appointments) {
      const { patient, start, _id } = appointment;

      if (!patient || !(typeof patient === 'object') || !('email' in patient)) {
        this.logger.warn(`⚠️ Paciente no poblado o sin email para cita ${_id}`);
        continue;
      }

      let clinicName = '';
      const mc = appointment.medicalClinic;
      if (mc && typeof mc === 'object' && mc !== null && 'medicalClinicName' in mc) {
        clinicName = (mc as MedicalClinic).medicalClinicName;
      }
      console.log(clinicName);

      const appointmentDate = new Date(start);
      const formattedDate = appointmentDate.toLocaleString(); // Formato de fecha

      const templateData = {
        name: patient.firstName,
        date: formattedDate,
        clinicName: (appointment.medicalClinic as MedicalClinic)?.medicalClinicName || '',
        clinicAddress: (appointment.medicalClinic as MedicalClinic)?.address || '',
        avatar: (appointment.medicalClinic as MedicalClinic)?.avatar || '',
        clinicPhone: (appointment.medicalClinic as MedicalClinic)?.phone || '',
        clinicEmail: (appointment.medicalClinic as MedicalClinic)?.email || '',
        clinicLogoUrl: 'https://denteapp.com/logo.png',
        confirmUrl: `https://denteapp.com/appointment/confirm/${_id}`,
        rescheduleUrl: `https://denteapp.com/appointment/reschedule/${_id}`,
        cancelUrl: `https://denteapp.com/appointment/cancel/${_id}`,
        // token: Math.random().toString(36).substring(2, 15), // Genera un token aleatorio
      };

      // Generamos el contenido HTML del correo usando la plantilla MJML
      const html = renderAppointmentReminderMJML(templateData);
      // console.log(html);


      // Enviar correo si está habilitada la notificación por correo
      if (appointment.notificationEmail && patient.email) {
        try {
          // Ensure appointment.user is populated and is of type User
          const user = appointment.user && typeof appointment.user === 'object' && 'firstName' in appointment.user
            ? appointment.user as User
            : null;

          await this.resend.emails.send({
            from: `dente <facturacion@denteapp.com>`,
            // cc: user?.email,
            // reply_to: user?.email,
            to: patient.email,
            subject: 'Recordatorio de cita médica',
            // text: "Recordatorio de cita médica",
            html,
          });

          this.logger.log(`📧 Correo enviado a ${patient.email}`);
        } catch (error) {
          this.logger.error(`❌ Error enviando correo a ${patient.email}`, error);
        }
      }
    }
  }
}
