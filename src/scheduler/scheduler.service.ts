import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Appointment, AppointmentDocument } from 'src/schema/appointment.schema';
import { AuditoryNotificationsPatient, AuditoryNotificationsPatientDocument } from 'src/schema/auditoryNotificationsPatient.schema';
import { addDays, startOfDay, endOfDay, addHours } from 'date-fns';
import { Resend } from 'resend';
import { Patient } from 'src/schema/patient.schema';
import { User } from 'src/schema/user.schema';
import { renderAppointmentReminderMJML } from './../utils/templates-appointment-reming.template';
import { MedicalClinic } from 'src/schema/medicalClinic.schema';
import { WhatsAppService } from 'src/whatsapp/whatsapp.service';
import { TimezoneUtils } from '../utils/timezone.utils';

type PopulatedAppointment = Appointment & {
  patient: Patient | Types.ObjectId;
  user: User | Types.ObjectId;
  medicalClinic: MedicalClinic | Types.ObjectId;
  branch: Types.ObjectId;
  _id: Types.ObjectId;
};

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);  // Inserta tu clave de API de Resend

  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(AuditoryNotificationsPatient.name)
    private readonly auditoryNotifModel: Model<AuditoryNotificationsPatientDocument>,
    private readonly whatsappService: WhatsAppService,
  ) { }

  /**
   * Obtiene la timezone de una clínica
   * Usa el campo timezone de la clínica o fallback a Honduras
   */
  private getClinicTimezone(clinic: any): string {
    return clinic?.timezone || TimezoneUtils.DEFAULT_TIMEZONE;
  }

  @Cron('0 8,10,12,14,16,18,20 * * *') // Ejecuta cada 2 horas (8 AM - 8 PM)
  async notifyAppointments24HoursBefore() {
    const startTime = new Date();
    this.logger.log(`🚀 [CRON 24H] Iniciando proceso de recordatorio 24 horas - ${startTime.toISOString()}`);

    try {
      const now = new Date();

      const twentyTwoHoursFromNow = addHours(now, 20);
      const twentySixHoursFromNow = addHours(now, 28);

      const appointments = await this.appointmentModel
        .find({
        status: 'Sin Confirmar',
        notificationWhatsapp: true,
        start: { $gte: twentyTwoHoursFromNow, $lte: twentySixHoursFromNow },
        'notificationsSent.type': { $ne: 'reminder_24h' },
      })
      .populate({
        path: 'patient',
        select: 'firstName lastName phoneNumber email',
      })
      .populate({
        path: 'medicalClinic',
        select: 'avatar medicalClinicName address phone email timezone',
      })
      .populate({
        path: 'user',
        select: 'firstName lastName email role',
      })
      .lean() as unknown as PopulatedAppointment[];

    let sentCount = 0;
    let skippedByScheduleCount = 0;
    let errorCount = 0;

    if (appointments.length === 0) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      this.logger.log(`ℹ️  [CRON 24H] Finalizado - No hay citas para procesar | Duración: ${duration}ms`);
      return;
    }

    for (const appointment of appointments) {
      const clinic = appointment.medicalClinic as any;
      const clinicTimezone = this.getClinicTimezone(clinic);
      
      // Validar si el mensaje llegaría en horario laboral (6 AM - 8 PM)
      const willBeInBusinessHours = TimezoneUtils.willBeDeliveredInBusinessHours(
        appointment.start,
        24,
        clinicTimezone,
        6,
        20
      );

      if (!willBeInBusinessHours) {
        skippedByScheduleCount++;
        const deliveryTime = new Date(appointment.start.getTime() - (24 * 60 * 60 * 1000));
        const deliveryHour = TimezoneUtils.getHourInTimezone(deliveryTime, clinicTimezone);
        this.logger.warn(
          `Omitido por horario (24h): Cita ${appointment._id} - Envío sería a las ${deliveryHour}:00 (${clinicTimezone})`
        );
        continue;
      }
      
      try {
        await this.sendNotificationWithLog(appointment, 'reminder_24h', '24h', clinicTimezone);
        sentCount++;
      } catch (error) {
        errorCount++;
        this.logger.error(
          `❌ Error notificación cita ${appointment._id}: ${error.message}`,
          error.stack
        );
      }
    }

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    if (sentCount > 0 || skippedByScheduleCount > 0) {
      this.logger.log(
        `✅ [CRON 24H] Finalizado - Procesadas: ${appointments.length} | Enviadas: ${sentCount} | Omitidas: ${skippedByScheduleCount} | Errores: ${errorCount} | Duración: ${duration}ms`
      );
    } else {
      this.logger.log(`ℹ️  [CRON 24H] Finalizado - No hay citas para procesar | Duración: ${duration}ms`);
    }
    } catch (error) {
      this.logger.error(
        `❌ [CRON 24H] Error crítico en proceso de recordatorio 24h: ${error.message}`,
        error.stack
      );
    }
  }

  @Cron('5 6,10,14,18 * * *') // Ejecuta 4 veces al día (incluye 6 AM para citas matutinas)
  async notifyAppointments4HoursBefore() {
    const startTime = new Date();
    this.logger.log(`🚀 [CRON 4H] Iniciando proceso de recordatorio 4 horas - ${startTime.toISOString()}`);

    try {
      const now = new Date();

      const threeHoursFromNow = addHours(now, 4);
      const sixHoursFromNow = addHours(now, 6);

      const appointments = await this.appointmentModel.find({
      status: 'Sin Confirmar',
      notificationWhatsapp: true,
      start: { $gte: threeHoursFromNow, $lte: sixHoursFromNow },
      'notificationsSent.type': { $ne: 'reminder_4h' },
    })
      .populate({
        path: 'patient',
        select: 'firstName lastName phoneNumber email',
      })
      .populate({
        path: 'medicalClinic',
        select: 'avatar medicalClinicName address phone email timezone',
      })
      .populate({
        path: 'user',
        select: 'firstName lastName email role',
      })
      .lean() as unknown as PopulatedAppointment[];

    let sentCount = 0;
    let skippedByScheduleCount = 0;
    let errorCount = 0;

    if (appointments.length === 0) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      this.logger.log(`ℹ️  [CRON 4H] Finalizado - No hay citas para procesar | Duración: ${duration}ms`);
      return;
    }

    for (const appointment of appointments) {
      const clinic = appointment.medicalClinic as any;
      const clinicTimezone = this.getClinicTimezone(clinic);
      
      // Validar si el mensaje llegaría en horario laboral (6 AM - 8 PM)
      const willBeInBusinessHours = TimezoneUtils.willBeDeliveredInBusinessHours(
        appointment.start,
        4,
        clinicTimezone,
        6,
        20
      );

      if (!willBeInBusinessHours) {
        skippedByScheduleCount++;
        const deliveryTime = new Date(appointment.start.getTime() - (4 * 60 * 60 * 1000));
        const deliveryHour = TimezoneUtils.getHourInTimezone(deliveryTime, clinicTimezone);
        this.logger.warn(
          `Omitido por horario (4h): Cita ${appointment._id} - Envío sería a las ${deliveryHour}:00 (${clinicTimezone})`
        );
        continue;
      }
      
      try {
        await this.sendNotificationWithLog(appointment, 'reminder_4h', '4h', clinicTimezone);
        sentCount++;
      } catch (error) {
        errorCount++;
        this.logger.error(
          `❌ Error notificación cita ${appointment._id}: ${error.message}`,
          error.stack
        );
      }
    }

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    if (sentCount > 0 || skippedByScheduleCount > 0) {
      this.logger.log(
        `✅ [CRON 4H] Finalizado - Procesadas: ${appointments.length} | Enviadas: ${sentCount} | Omitidas: ${skippedByScheduleCount} | Errores: ${errorCount} | Duración: ${duration}ms`
      );
    } else {
      this.logger.log(`ℹ️  [CRON 4H] Finalizado - No hay citas para procesar | Duración: ${duration}ms`);
    }
    } catch (error) {
      this.logger.error(
        `❌ [CRON 4H] Error crítico en proceso de recordatorio 4h: ${error.message}`,
        error.stack
      );
    }
  }

  @Cron('10 8,10,12,14,16,18,20 * * *') // Ejecuta cada 2 horas (8 AM - 8 PM)
  async notifyConfirmedAppointments2HoursBefore() {
    const startTime = new Date();
    this.logger.log(`🚀 [CRON 2H] Iniciando proceso de recordatorio 2 horas - ${startTime.toISOString()}`);

    try {
      const now = new Date();

      const oneHourFromNow = addHours(now, 1);
      const fourHoursFromNow = addHours(now, 3);

      const appointments = await this.appointmentModel.find({
      start: { $gte: oneHourFromNow, $lte: fourHoursFromNow },
      notificationWhatsapp: true,
      status: 'Confirmada',
      'notificationsSent.type': { $ne: 'reminder_2h' },
    })
      .populate({
        path: 'patient',
        select: 'firstName lastName phoneNumber email',
      })
      .populate({
        path: 'medicalClinic',
        select: 'avatar medicalClinicName address phone email timezone',
      })
      .populate({
        path: 'user',
        select: 'firstName lastName email role',
      })
      .lean() as unknown as PopulatedAppointment[];

    let sentCount = 0;
    let skippedByScheduleCount = 0;
    let errorCount = 0;

    if (appointments.length === 0) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      this.logger.log(`ℹ️  [CRON 2H] Finalizado - No hay citas para procesar | Duración: ${duration}ms`);
      return;
    }

    for (const appointment of appointments) {
      const clinic = appointment.medicalClinic as any;
      const clinicTimezone = this.getClinicTimezone(clinic);
      
      // Validar si el mensaje llegaría en horario laboral (6 AM - 8 PM)
      const willBeInBusinessHours = TimezoneUtils.willBeDeliveredInBusinessHours(
        appointment.start,
        2,
        clinicTimezone,
        6,
        20
      );

      if (!willBeInBusinessHours) {
        skippedByScheduleCount++;
        const deliveryTime = new Date(appointment.start.getTime() - (2 * 60 * 60 * 1000));
        const deliveryHour = TimezoneUtils.getHourInTimezone(deliveryTime, clinicTimezone);
        this.logger.warn(
          `Omitido por horario (2h): Cita ${appointment._id} - Envío sería a las ${deliveryHour}:00 (${clinicTimezone})`
        );
        continue;
      }
      
      try {
        await this.sendNotificationWithLog(appointment, 'reminder_2h', '2h', clinicTimezone);
        sentCount++;
      } catch (error) {
        errorCount++;
        this.logger.error(
          `❌ Error notificación cita ${appointment._id}: ${error.message}`,
          error.stack
        );
      }
    }

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    if (sentCount > 0 || skippedByScheduleCount > 0) {
      this.logger.log(
        `✅ [CRON 2H] Finalizado - Procesadas: ${appointments.length} | Enviadas: ${sentCount} | Omitidas: ${skippedByScheduleCount} | Errores: ${errorCount} | Duración: ${duration}ms`
      );
    } else {
      this.logger.log(`ℹ️  [CRON 2H] Finalizado - No hay citas para procesar | Duración: ${duration}ms`);
    }
    } catch (error) {
      this.logger.error(
        `❌ [CRON 2H] Error crítico en proceso de recordatorio 2h: ${error.message}`,
        error.stack
      );
    }
  }

  @Cron('0 7 * * *') // Ejecuta una vez al día a las 7 AM
  async notifyEarlyMorningAppointmentsSpecial() {
    const startTime = new Date();
    this.logger.log(`🚀 [CRON MATUTINO] Iniciando proceso especial para citas tempranas - ${startTime.toISOString()}`);

    try {
      const now = new Date();

      const oneHourFromNow = addHours(now, 1);
      const threeHoursFromNow = addHours(now, 3);

      // Buscar citas matutinas (8-10 AM) que NO recibieron notificación previa
      const appointments = await this.appointmentModel.find({
        start: { $gte: oneHourFromNow, $lte: threeHoursFromNow },
        notificationWhatsapp: true,
        $or: [
          { notificationsSent: { $exists: false } },
          { notificationsSent: { $size: 0 } },
          { 
            $and: [
              { 'notificationsSent.type': { $ne: 'reminder_24h' } },
              { 'notificationsSent.type': { $ne: 'reminder_4h' } },
              { 'notificationsSent.type': { $ne: 'reminder_morning' } }
            ]
          }
        ],
      })
      .populate({
        path: 'patient',
        select: 'firstName lastName phoneNumber email',
      })
      .populate({
        path: 'medicalClinic',
        select: 'avatar medicalClinicName address phone email timezone',
      })
      .populate({
        path: 'user',
        select: 'firstName lastName secondLastName gender',
      })
      .exec();

      this.logger.log(`📋 [CRON MATUTINO] Encontradas ${appointments.length} citas matutinas sin notificación previa`);

      let sentCount = 0;
      let errorCount = 0;

      for (const appointment of appointments as PopulatedAppointment[]) {
        try {
          const mc = appointment.medicalClinic;
          const clinicTimezone = this.getClinicTimezone(mc);

          await this.sendNotificationWithLog(appointment, 'reminder_morning', 'morning', clinicTimezone);
          sentCount++;
          this.logger.log(`   ✅ Notificación matutina enviada para cita ${appointment._id}`);
        } catch (error) {
          errorCount++;
          this.logger.error(`   ❌ Error enviando notificación matutina para cita ${appointment._id}: ${error.message}`);
        }
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      if (sentCount > 0) {
        this.logger.log(
          `✅ [CRON MATUTINO] Finalizado - Procesadas: ${appointments.length} | Enviadas: ${sentCount} | Errores: ${errorCount} | Duración: ${duration}ms`
        );
      } else {
        this.logger.log(`ℹ️  [CRON MATUTINO] Finalizado - No hay citas matutinas para procesar | Duración: ${duration}ms`);
      }
    } catch (error) {
      this.logger.error(
        `❌ [CRON MATUTINO] Error crítico en proceso matutino: ${error.message}`,
        error.stack
      );
    }
  }

  // 📤 Método auxiliar para enviar notificaciones (Email + WhatsApp)
  // Retorna el messageId de WhatsApp para tracking
  private async sendAppointmentNotifications(
    appointment: PopulatedAppointment, 
    type: string,
    timezone: string = TimezoneUtils.DEFAULT_TIMEZONE
  ): Promise<string | null> {
    const { patient, start, _id } = appointment;

    if (!patient || !(typeof patient === 'object') || !('email' in patient)) {
      return null;
    }

    let clinicName = '';
    const mc = appointment.medicalClinic;
    if (mc && typeof mc === 'object' && mc !== null && 'medicalClinicName' in mc) {
      clinicName = (mc as MedicalClinic).medicalClinicName;
    }

    const appointmentDate = new Date(start);
    
    // Usar TimezoneUtils para formatear con timezone específico
    const { date: formattedDate, time: formattedTime } = TimezoneUtils.formatAppointmentDateTime(
      appointmentDate,
      timezone
    );
    
    const { date: whatsappDate, time: whatsappTime } = TimezoneUtils.formatAppointmentForWhatsApp(
      appointmentDate,
      timezone
    );
    
    const formattedDateLong = new Intl.DateTimeFormat('es-ES', { 
      timeZone: timezone,
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    }).format(appointmentDate);

    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';

    const templateData = {
      name: patient.firstName,
      date: formattedDateLong,
      clinicName: (appointment.medicalClinic as MedicalClinic)?.medicalClinicName || '',
      clinicAddress: (appointment.medicalClinic as MedicalClinic)?.address || '',
      avatar: (appointment.medicalClinic as MedicalClinic)?.avatar || '',
      clinicPhone: (appointment.medicalClinic as MedicalClinic)?.phone || '',
      clinicEmail: (appointment.medicalClinic as MedicalClinic)?.email || '',
      clinicLogoUrl: (appointment.medicalClinic as MedicalClinic)?.avatar || 'https://denteapp.com/logo.png',
      confirmUrl: `${baseUrl}/appointments/confirm/${_id}`,
      rescheduleUrl: `${baseUrl}/appointments/reschedule/${_id}`,
      cancelUrl: `${baseUrl}/appointments/cancel/${_id}`,
    };

    // ⚠️ EMAIL DESHABILITADO - Solo WhatsApp activo
    // if (appointment.notificationEmail && patient.email) {
    //   try {
    //     const html = renderAppointmentReminderMJML(templateData);

    //     await this.resend.emails.send({
    //       from: `dente <facturacion@denteapp.com>`,
    //       to: patient.email,
    //       subject: `Recordatorio de cita - ${clinicName}`,
    //       html,
    //     });

    //     this.logger.log(`📧 Email enviado (${type}): ${patient.email}`);
    //   } catch (error) {
    //     const errorMessage = error instanceof Error ? error.message : String(error);
    //     this.logger.error(`Error email (${type}): ${patient.email} - ${errorMessage}`);
    //   }
    // }

    const phoneNumber = patient.phoneNumber;

    if (appointment.notificationWhatsapp && phoneNumber) {
      const appointmentUser = appointment.user as any;
      
      // Obtener nombre del doctor con título (Dr/Dra) según género
      let doctorName = 'nuestro equipo';
      if (appointmentUser && typeof appointmentUser === 'object' && appointmentUser.firstName) {
        const doctorGender = appointmentUser.gender || 'male';
        const doctorTitle = doctorGender?.toLowerCase() === 'female' ? 'Dra' : 'Dr';
        doctorName = `${doctorTitle} ${appointmentUser.firstName} ${appointmentUser.lastName || ''}`.trim();
      }

      let whatsappError: string | null = null;
      let messageId: string | null = null;

      try {
        
        if (type === '24h') {
          messageId = await this.whatsappService.sendAppointmentReminderTemplate(
            phoneNumber,
            _id.toString(),
            patient.firstName,
            doctorName,
            whatsappDate,
            whatsappTime,
            clinicName,
          );
        } else if (type === '4h') {
          // Formatear fecha corta: "lunes 3 de enero" (sin año)
          const dateShort = new Intl.DateTimeFormat('es-ES', {
            timeZone: timezone,
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(appointmentDate);

          // Hora en formato 12h con AM/PM
          const time12h = new Intl.DateTimeFormat('es-ES', {
            timeZone: timezone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }).format(appointmentDate);

          // Obtener título del doctor
          const doctorGender = (appointmentUser && appointmentUser.gender) || 'male';
          const doctorTitle = doctorGender?.toLowerCase() === 'female' ? 'la Dra' : 'el Dr';
          
          // Nombre del doctor SIN título
          const doctorNameOnly = (appointmentUser && typeof appointmentUser === 'object' && appointmentUser.firstName)
            ? `${appointmentUser.firstName} ${appointmentUser.lastName || ''}`.trim()
            : 'nuestro equipo';

          messageId = await this.whatsappService.sendAppointmentReminder4hTemplate(
            phoneNumber,
            _id.toString(),
            patient.firstName,
            doctorNameOnly,
            dateShort,
            time12h,
            clinicName,
            doctorTitle,
          );
        } else if (type === '2h') {
          messageId = await this.whatsappService.sendAppointmentReminder2hTemplate(
            phoneNumber,
            patient.firstName,
            doctorName,
          );
        } else if (type === 'morning') {
          // Cron matutino especial: usa template de 4h para citas sin notificación previa
          // Formatear fecha corta: "lunes 3 de enero" (sin año)
          const dateShort = new Intl.DateTimeFormat('es-ES', {
            timeZone: timezone,
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(appointmentDate);

          // Hora en formato 12h con AM/PM
          const time12h = new Intl.DateTimeFormat('es-ES', {
            timeZone: timezone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }).format(appointmentDate);

          // Obtener título del doctor
          const doctorGender = (appointmentUser && appointmentUser.gender) || 'male';
          const doctorTitle = doctorGender?.toLowerCase() === 'female' ? 'la Dra' : 'el Dr';
          
          // Nombre del doctor SIN título
          const doctorNameOnly = (appointmentUser && typeof appointmentUser === 'object' && appointmentUser.firstName)
            ? `${appointmentUser.firstName} ${appointmentUser.lastName || ''}`.trim()
            : 'nuestro equipo';

          messageId = await this.whatsappService.sendAppointmentReminder4hTemplate(
            phoneNumber,
            _id.toString(),
            patient.firstName,
            doctorNameOnly,
            dateShort,
            time12h,
            clinicName,
            doctorTitle,
          );
        }
      } catch (error) {
        whatsappError = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error WhatsApp (${type}): ${patient.firstName} - ${whatsappError}`);
      }

      // Registrar envío en AuditoryNotificationsPatient
      await this.auditoryNotifModel.create({
        patientId: (patient as any)._id,
        medicalClinic: (appointment.medicalClinic as any)._id ?? appointment.medicalClinic,
        branch: appointment.branch,
        reason: `Recordatorio de cita ${type} antes`,
        notificationType: 'reminder',
        channel: 'whatsapp',
        message: `Recordatorio ${type} enviado a ${patient.firstName} (${phoneNumber})`,
        status: whatsappError ? 'fallido' : 'enviado',
        provider: 'meta_whatsapp',
        sentAt: new Date(),
        ...(messageId && { externalId: messageId }),
        ...(whatsappError && { errorDetails: { message: whatsappError } }),
        metadata: { appointmentId: _id.toString(), notificationType: `reminder_${type}` },
      }).catch(e => {
        this.logger.error(`Error registrando auditoría WhatsApp: ${e.message}`);
      });
      
      return messageId;
    }
    
    return null;
  }

  // 📋 Método para enviar notificaciones CON registro en NotificationLog
  private async sendNotificationWithLog(
    appointment: PopulatedAppointment,
    notificationType: 'reminder_24h' | 'reminder_4h' | 'reminder_2h' | 'reminder_morning',
    displayType: '24h' | '4h' | '2h' | 'morning',
    timezone: string = TimezoneUtils.DEFAULT_TIMEZONE
  ) {
    const { patient, _id, medicalClinic } = appointment;

    if (!patient || typeof patient !== 'object' || !('email' in patient)) {
      return;
    }

    if (!medicalClinic || typeof medicalClinic !== 'object' || !('_id' in medicalClinic)) {
      return;
    }

    try {
      const messageId = await this.sendAppointmentNotifications(appointment, displayType, timezone);
      
      const notificationData: any = { 
        type: notificationType, 
        status: 'enviado', 
        sentAt: new Date() 
      };
      
      if (messageId) {
        notificationData.messageId = messageId;
      }
      
      await this.appointmentModel.findByIdAndUpdate(_id, {
        $push: { notificationsSent: notificationData },
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Error notificación ${notificationType}: ${errorMessage}`);
      await this.appointmentModel.findByIdAndUpdate(_id, {
        $push: { notificationsSent: { type: notificationType, status: 'fallido', sentAt: new Date() } },
      }).catch(() => {
        this.logger.error(`No se pudo actualizar el registro de error en la cita`);
      });
    }
  }
}
