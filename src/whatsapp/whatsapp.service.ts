import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Appointment, AppointmentDocument } from 'src/schema/appointment.schema';
import { AuditoryNotificationsPatient, AuditoryNotificationsPatientDocument } from 'src/schema/auditoryNotificationsPatient.schema';
import { MedicalClinic, MedicalClinicDocument } from 'src/schema/medicalClinic.schema';
import { User, UserDocument } from 'src/schema/user.schema';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { TimezoneUtils } from '../utils/timezone.utils';

interface WhatsAppButton {
  type: 'reply';
  reply: {
    id: string;
    title: string;
  };
}

interface WhatsAppMessagePayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'button';
    body: {
      text: string;
    };
    action: {
      buttons: WhatsAppButton[];
    };
  };
}

interface WhatsAppTextMessagePayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: {
    body: string;
  };
}

interface WhatsAppLocationMessagePayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'location';
  location: {
    latitude: string;
    longitude: string;
    name: string;
    address: string;
  };
}

interface WhatsAppCTAUrlMessagePayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'cta_url';
    body: {
      text: string;
    };
    action: {
      name: 'cta_url';
      parameters: {
        display_text: string;
        url: string;
      };
    };
  };
}

interface WhatsAppTemplateMessagePayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'template';
  template: {
    name: string;
    language: {
      code: string;
    };
    components?: Array<{
      type: string;
      sub_type?: string;
      index?: number;
      parameters: Array<{
        type: string;
        text?: string;
        payload?: string;
      }>;
    }>;
  };
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly apiUrl: string;
  private readonly resend: Resend;

  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(AuditoryNotificationsPatient.name)
    private readonly auditoryNotifModel: Model<AuditoryNotificationsPatientDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {
    this.phoneNumberId = this.configService.get<string>('META_WHATSAPP_PHONE_NUMBER_ID') || '';
    this.accessToken = this.configService.get<string>('META_WHATSAPP_ACCESS_TOKEN') || '';
    this.apiUrl = `https://graph.facebook.com/v24.0/${this.phoneNumberId}/messages`;
    this.resend = new Resend(this.configService.get<string>('RESEND_API_KEY'));
  }

  /**
   * Envía un mensaje de WhatsApp con botones interactivos para recordatorio de cita
   */
  async sendAppointmentReminder(
    phoneNumber: string,
    appointmentId: string,
    patientName: string,
    appointmentDate: string,
    clinicName: string,
  ): Promise<void> {
    let formattedPhone: string;
    
    try {
      formattedPhone = this.formatPhoneNumber(phoneNumber);
    } catch (error) {
      // Error de validación de número - NO enviar alerta
      this.logger.error(`❌ ERROR de validación para ${phoneNumber}: ${error.message}`);
      throw error;
    }

    try {
      const message = `Hola ${patientName}! 👋\n\nTe recordamos que tienes una cita odontológica:\n\n📅 Fecha: ${appointmentDate}\n🏥 Clínica: ${clinicName}\n\nPor favor, confirma o cancela tu cita:`;

      const payload: WhatsAppMessagePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: message,
          },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: {
                  id: `confirm_${appointmentId}`,
                  title: '✅ Confirmar',
                },
              },
              {
                type: 'reply',
                reply: {
                  id: `cancel_${appointmentId}`,
                  title: '❌ Cancelar',
                },
              },
            ],
          },
        },
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        this.logger.error(`❌ ERROR en Meta WhatsApp API`);
        this.logger.error(`   └─ Teléfono: ${phoneNumber}`);
        this.logger.error(`   └─ Status: ${response.status} ${response.statusText}`);
        this.logger.error(`   └─ Detalles: ${JSON.stringify(errorData, null, 2)}`);
        
        // Enviar alerta solo para errores de API
        await this.sendFailureAlert(
          'Recordatorio de Cita (Botones)',
          phoneNumber,
          patientName,
          `Meta API Error [${response.status}]: ${JSON.stringify(errorData)}`,
        );
        
        throw new Error(`Meta API error: ${JSON.stringify(errorData)}`);
      }

      await response.json();
    } catch (error) {
      // Si ya es un error de Meta API, no enviar alerta de nuevo
      if (error.message?.includes('Meta API error')) {
        throw error;
      }
      
      // Error de red/timeout - enviar alerta
      this.logger.error(`❌ ERROR enviando WhatsApp a ${phoneNumber}: ${error.message}`);
      await this.sendFailureAlert(
        'Recordatorio de Cita (Botones)',
        phoneNumber,
        patientName,
        `Network/Timeout Error: ${error.message}`,
      );
      
      throw error;
    }
  }

  /**
   * Envía un recordatorio de cita usando un template aprobado de WhatsApp
   * IMPORTANTE: Este método funciona sin necesidad de conversación activa
   * Requiere que el template esté aprobado en Meta
   * @returns messageId de WhatsApp para tracking de estado
   */
  async sendAppointmentReminderTemplate(
    phoneNumber: string,
    appointmentId: string,
    patientName: string,
    doctorName: string,
    appointmentDate: string,
    appointmentTime: string,
    clinicName: string,
  ): Promise<string> {
    let formattedPhone: string;
    
    try {
      formattedPhone = this.formatPhoneNumber(phoneNumber);
    } catch (error) {
      // Error de validación de número - NO enviar alerta
      this.logger.error(`❌ ERROR de validación para ${phoneNumber}: ${error.message}`);
      throw error;
    }

    try {
      const payload: WhatsAppTemplateMessagePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'template',
        template: {
          name: 'appointment_reminder',
          language: {
            code: 'es_HN', // Español Honduras
          },
          components: [
            {
              type: 'header',
              parameters: [
                { type: 'text', text: clinicName },
              ],
            },
            {
              type: 'body',
              parameters: [
                { type: 'text', text: patientName },
                { type: 'text', text: doctorName },
                { type: 'text', text: appointmentDate },
                { type: 'text', text: appointmentTime },
              ],
            },
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: 0,
              parameters: [
                { type: 'payload', payload: `confirm_${appointmentId}` },
              ],
            },
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: 1,
              parameters: [
                { type: 'payload', payload: `cancel_${appointmentId}` },
              ],
            },
          ],
        },
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json();

      if (!response.ok) {
        this.logger.error(`❌ ERROR en Meta WhatsApp API (Template)`);
        this.logger.error(`   └─ Teléfono: ${phoneNumber}`);
        this.logger.error(`   └─ Status: ${response.status} ${response.statusText}`);
        this.logger.error(`   └─ Detalles: ${JSON.stringify(responseData, null, 2)}`);
        
        // Enviar alerta solo para errores de API
        await this.sendFailureAlert(
          'Recordatorio de Cita (Template)',
          phoneNumber,
          patientName,
          `Meta API Error [${response.status}]: ${JSON.stringify(responseData)}`,
        );
        
        throw new Error(`Meta API error: ${JSON.stringify(responseData)}`);
      }

      const messageId = responseData.messages?.[0]?.id || '';
      return messageId;
    } catch (error) {
      // Si ya es un error de Meta API, no enviar alerta de nuevo
      if (error.message?.includes('Meta API error')) {
        throw error;
      }
      
      // Error de red/timeout - enviar alerta
      this.logger.error(`❌ ERROR enviando template de WhatsApp a ${phoneNumber}: ${error.message}`);
      await this.sendFailureAlert(
        'Recordatorio de Cita (Template)',
        phoneNumber,
        patientName,
        `Network/Timeout Error: ${error.message}`,
      );
      
      throw error;
    }
  }

  /**
   * Template: Recordatorio 4h antes con botones (para citas NO confirmadas)
   * @returns messageId de WhatsApp para tracking de estado
   */
  async sendAppointmentReminder4hTemplate(
    phoneNumber: string,
    appointmentId: string,
    patientName: string,
    doctorName: string,
    dateShort: string,
    appointmentTime: string,
    clinicName: string,
    doctorTitle: string,
  ): Promise<string> {
    let formattedPhone: string;
    
    try {
      formattedPhone = this.formatPhoneNumber(phoneNumber);
    } catch (error) {
      this.logger.error(`❌ ERROR de validación: ${error.message}`);
      throw error;
    }

    try {
      const payload: WhatsAppTemplateMessagePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'template',
        template: {
          name: 'appointment_reminder_4h',
          language: {
            code: 'es_HN',
          },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: patientName },
                { type: 'text', text: doctorName },
                { type: 'text', text: dateShort },
                { type: 'text', text: appointmentTime },
                { type: 'text', text: clinicName },
                { type: 'text', text: doctorTitle },
              ],
            },
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: 0,
              parameters: [
                { type: 'payload', payload: `confirm_${appointmentId}` },
              ],
            },
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: 1,
              parameters: [
                { type: 'payload', payload: `cancel_${appointmentId}` },
              ],
            },
          ],
        },
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        await this.sendFailureAlert(
          'Recordatorio 4h',
          phoneNumber,
          patientName,
          `Meta API Error: ${JSON.stringify(errorData)}`,
        );
        throw new Error(`Meta API error: ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      const messageId = result.messages?.[0]?.id || '';
      return messageId;
    } catch (error) {
      if (!error.message?.includes('Meta API error')) {
        this.logger.error(`❌ Error: ${error.message}`);
        await this.sendFailureAlert(
          'Recordatorio 4h',
          phoneNumber,
          patientName,
          `Network Error: ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Template: Recordatorio 2h antes sin botones (para citas YA confirmadas)
   * @returns messageId de WhatsApp para tracking de estado
   */
  async sendAppointmentReminder2hTemplate(
    phoneNumber: string,
    patientName: string,
    doctorName: string,
  ): Promise<string> {
    let formattedPhone: string;
    
    try {
      formattedPhone = this.formatPhoneNumber(phoneNumber);
    } catch (error) {
      this.logger.error(`❌ ERROR de validación: ${error.message}`);
      throw error;
    }

    try {
      const payload: WhatsAppTemplateMessagePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'template',
        template: {
          name: 'appointment_reminder_soon',
          language: {
            code: 'es_HN',
          },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: patientName },
                { type: 'text', text: doctorName },
              ],
            },
          ],
        },
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Meta API error: ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      const messageId = result.messages?.[0]?.id || '';
      return messageId;
    } catch (error) {
      this.logger.error(`❌ Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Template: Confirmación recibida (respuesta webhook)
   * @returns messageId de WhatsApp para tracking de estado
   */
  async sendConfirmationTemplate(
    phoneNumber: string,
    patientName: string,
    doctorName: string,
    doctorGender: string,
    appointmentDate: string,
    appointmentTime: string,
    clinicName: string,
  ): Promise<string> {
    let formattedPhone: string;
    
    try {
      formattedPhone = this.formatPhoneNumber(phoneNumber);
    } catch (error) {
      this.logger.error(`❌ ERROR de validación: ${error.message}`);
      throw error;
    }

    // Determinar título según género
    const doctorTitle = doctorGender?.toLowerCase() === 'female' ? 'la Dra' : 'el Dr';

    try {
      const payload: WhatsAppTemplateMessagePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'template',
        template: {
          name: 'appointment_confirmation',
          language: {
            code: 'es_HN',
          },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: patientName },
                { type: 'text', text: appointmentDate },
                { type: 'text', text: appointmentTime },
                { type: 'text', text: doctorTitle },
                { type: 'text', text: doctorName },
              ],
            },
          ],
        },
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Meta API error: ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      const messageId = result.messages?.[0]?.id || '';
      return messageId;
    } catch (error) {
      this.logger.error(`❌ Error confirmación: ${error.message}`);
      throw error;
    }
  }

  /**
   * Template: Cancelación confirmada (respuesta webhook)
   * @returns messageId de WhatsApp para tracking de estado
   */
  async sendCancellationTemplate(
    phoneNumber: string,
    doctorName: string,
    doctorGender: string,
    appointmentDate: string,
    appointmentTime: string,
  ): Promise<string> {
    let formattedPhone: string;
    
    try {
      formattedPhone = this.formatPhoneNumber(phoneNumber);
    } catch (error) {
      this.logger.error(`❌ ERROR de validación: ${error.message}`);
      throw error;
    }

    // Determinar título según género
    const doctorTitle = doctorGender?.toLowerCase() === 'female' ? 'la Dra' : 'el Dr';

    try {
      const payload: WhatsAppTemplateMessagePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'template',
        template: {
          name: 'appointment_cancelled',
          language: {
            code: 'es_HN',
          },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: doctorTitle },
                { type: 'text', text: doctorName },
                { type: 'text', text: appointmentDate },
                { type: 'text', text: appointmentTime },
              ],
            },
          ],
        },
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Meta API error: ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      const messageId = result.messages?.[0]?.id || '';
      return messageId;
    } catch (error) {
      this.logger.error(`❌ Error cancelación: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envía un mensaje de texto simple de confirmación
   */
  async sendConfirmationMessage(phoneNumber: string, message: string): Promise<void> {
    let formattedPhone: string;
    
    try {
      formattedPhone = this.formatPhoneNumber(phoneNumber);
    } catch (error) {
      // Error de validación de número - NO enviar alerta
      this.logger.error(`❌ ERROR de validación para ${phoneNumber}: ${error.message}`);
      throw error;
    }

    try {
      const payload: WhatsAppTextMessagePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'text',
        text: {
          body: message,
        },
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        
        // Enviar alerta solo para errores de API
        await this.sendFailureAlert(
          'Mensaje de Confirmación',
          phoneNumber,
          'Usuario',
          `Meta API Error [${response.status}]: ${JSON.stringify(errorData)}`,
        );
        
        throw new Error(`Meta API error: ${JSON.stringify(errorData)}`);
      }

      await response.json();
    } catch (error) {
      // Si ya es un error de Meta API, no enviar alerta de nuevo
      if (error.message?.includes('Meta API error')) {
        throw error;
      }
      
      // Error de red/timeout - enviar alerta
      this.logger.error(`❌ Error enviando mensaje a ${phoneNumber}: ${error.message}`);
      await this.sendFailureAlert(
        'Mensaje de Confirmación',
        phoneNumber,
        'Usuario',
        `Network/Timeout Error: ${error.message}`,
      );
      
      throw error;
    }
  }

  /**
   * Procesa la respuesta de un botón y actualiza el estado de la cita
   */
  async handleButtonResponse(buttonId: string, phoneNumber: string): Promise<void> {
    try {
      const [action, appointmentId] = buttonId.split('_');

      if (!appointmentId || !['confirm', 'cancel', 'reschedule'].includes(action)) {
        return;
      }

      let newStatus: string;
      if (action === 'confirm') {
        newStatus = 'Confirmada';
      } else if (action === 'cancel') {
        newStatus = 'Cancelada';
      } else {
        newStatus = 'Reprogramar';
      }
      
      const confirmationChannel = 'WhatsApp';
      
      // Solo actualizar si está "Sin Confirmar" o "Reprogramar" (actualización atómica)
      const appointment = await this.appointmentModel
        .findOneAndUpdate(
          { 
            _id: appointmentId,
            status: { $in: ['Sin Confirmar', 'Reprogramar'] } // Solo actualizar si está en estos estados
          },
          { 
            status: newStatus,
            confirmationChannel: confirmationChannel
          },
          { new: true },
        )
        .populate('medicalClinic')
        .populate('patient')
        .populate('user')
        .exec();

      if (!appointment) {
        // Si appointment es null, la condición de status no se cumplió
        // Significa que probablemente ya está confirmada/cancelada
        const existingAppointment = await this.appointmentModel.findById(appointmentId);
        if (existingAppointment) {
          if (existingAppointment.status === 'Confirmada') {
            await this.sendConfirmationMessage(
              phoneNumber,
              'Tu cita ya fue confirmada, si necesitas reprogramar contacta con tu clínica.',
            );
            this.logger.log(`⚠️ Intento de cambiar cita ya confirmada: ${appointmentId}`);
          } else if (existingAppointment.status === 'Cancelada') {
            await this.sendConfirmationMessage(
              phoneNumber,
              'Tu cita ya fue cancelada, si necesitas reprogramar contacta con tu clínica.',
            );
            this.logger.log(`⚠️ Intento de cambiar cita ya cancelada: ${appointmentId}`);
          }
        } else {
          await this.sendConfirmationMessage(
            phoneNumber,
            '❌ Lo sentimos, no pudimos encontrar tu cita. Por favor, contacta con la clínica.',
          );
        }
        return;
      }

      const clinic = appointment.medicalClinic as any as MedicalClinicDocument;
      const patient = appointment.patient as any;
      const appointmentUser = appointment.user as any;
      const clinicName = clinic?.medicalClinicName || 'la clínica';
      const patientName = patient?.firstName || 'estimado/a';
      const doctorName = (appointmentUser?.firstName)
        ? `${appointmentUser.firstName} ${appointmentUser.lastName || ''}`.trim()
        : 'nuestro equipo';
      
      // Formatear fecha y hora usando el mismo formato amigable que recordatorios
      const startDate = new Date(appointment.start);
      // Futuro: usar clinic?.timezone cuando se agregue al schema
      const clinicTimezone = TimezoneUtils.DEFAULT_TIMEZONE;
      const { date: appointmentDate, time: appointmentTime } = TimezoneUtils.formatAppointmentForWhatsApp(
        startDate,
        clinicTimezone
      );
      const clinicPhone = clinic?.phone || '9999-9999';

      let messageId: string | null = null;
      let notificationType: string = '';

      if (action === 'confirm') {
        const doctorGender = appointmentUser?.gender || 'male';
        
        // Usar template de confirmación (español HND)
        messageId = await this.sendConfirmationTemplate(
          phoneNumber,
          patientName,
          doctorName,
          doctorGender,
          appointmentDate,
          appointmentTime,
          clinicName,
        );
        notificationType = 'confirmation';
        
        // Actualizar el último recordatorio (24h o 4h) con la confirmación
        const appointmentForUpdate = await this.appointmentModel.findById(appointmentId);
        
        if (!appointmentForUpdate) {
          this.logger.error(`Cita no encontrada para actualizar confirmación: ${appointmentId}`);
        } else {
          let lastReminderIndex = -1;
          for (let i = appointmentForUpdate.notificationsSent.length - 1; i >= 0; i--) {
            const notif = appointmentForUpdate.notificationsSent[i];
          if (notif.type === 'reminder_24h' || notif.type === 'reminder_4h') {
            lastReminderIndex = i;
            break;
          }
        }

          if (lastReminderIndex !== -1) {
            await this.appointmentModel.findByIdAndUpdate(appointmentId, {
              $set: {
                [`notificationsSent.${lastReminderIndex}.confirmedAt`]: new Date(),
                [`notificationsSent.${lastReminderIndex}.status`]: 'confirmado',
              }
            }).catch(err => {
              this.logger.error(`Error actualizando recordatorio confirmado: ${err.message}`);
            });
          }
        }
        
        // Registrar en auditoría para tracking de webhooks
        await this.auditoryNotifModel.create({
          patientId: patient._id,
          medicalClinic: clinic._id,
          branch: appointment.branch,
          reason: 'Confirmación de cita por WhatsApp',
          notificationType: 'confirmation',
          channel: 'whatsapp',
          message: `Confirmación enviada a ${patientName} (${phoneNumber})`,
          status: 'enviado',
          provider: 'meta_whatsapp',
          sentAt: new Date(),
          externalId: messageId,
          metadata: { appointmentId: appointmentId, action: 'confirm' },
        }).catch(err => {
          this.logger.error(`Error auditoría confirmación: ${err.message}`);
        });
        
      } else if (action === 'cancel') {
        const doctorGender = appointmentUser?.gender || 'male';
        
        // Usar template de cancelación (español)
        messageId = await this.sendCancellationTemplate(
          phoneNumber,
          doctorName,
          doctorGender,
          appointmentDate,
          appointmentTime,
        );
        notificationType = 'cancellation';
        
        // Actualizar el último recordatorio (24h o 4h) con la cancelación
        const appointmentForUpdate = await this.appointmentModel.findById(appointmentId);
        
        if (!appointmentForUpdate) {
          this.logger.error(`Cita no encontrada para actualizar cancelación: ${appointmentId}`);
        } else {
          let lastReminderIndex = -1;
          for (let i = appointmentForUpdate.notificationsSent.length - 1; i >= 0; i--) {
            const notif = appointmentForUpdate.notificationsSent[i];
          if (notif.type === 'reminder_24h' || notif.type === 'reminder_4h') {
            lastReminderIndex = i;
            break;
          }
        }

          if (lastReminderIndex !== -1) {
            await this.appointmentModel.findByIdAndUpdate(appointmentId, {
              $set: {
                [`notificationsSent.${lastReminderIndex}.cancelledAt`]: new Date(),
                [`notificationsSent.${lastReminderIndex}.status`]: 'cancelado',
              }
            }).catch(err => {
              this.logger.error(`Error actualizando recordatorio cancelado: ${err.message}`);
            });
          }
        }
        
        // Registrar en auditoría para tracking de webhooks
        await this.auditoryNotifModel.create({
          patientId: patient._id,
          medicalClinic: clinic._id,
          branch: appointment.branch,
          reason: 'Cancelación de cita por WhatsApp',
          notificationType: 'cancellation',
          channel: 'whatsapp',
          message: `Cancelación enviada a ${patientName} (${phoneNumber})`,
          status: 'enviado',
          provider: 'meta_whatsapp',
          sentAt: new Date(),
          externalId: messageId,
          metadata: { appointmentId: appointmentId, action: 'cancel' },
        }).catch(err => {
          this.logger.error(`Error auditoría cancelación: ${err.message}`);
        });
        
      } else {
        // Reprogramar - usa texto libre (no hay template)
        const thankYouMessage = `Gracias por informarnos, ${patientName}. 📅\n\nHemos notificado a ${clinicName} sobre tu solicitud de reprogramación. Pronto se pondrán en contacto contigo.`;
        await this.sendConfirmationMessage(phoneNumber, thankYouMessage);
        await this.sendRescheduleEmail(appointment, clinic, patient);
      }
    } catch (error) {
      this.logger.error(`❌ ERROR procesando respuesta: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envía la ubicación de la clínica como botón interactivo con URL
   * Aprovecha la ventana de 24 horas (gratis después del mensaje inicial)
   */
  async sendLocationAsLink(
    phoneNumber: string,
    clinic: MedicalClinicDocument,
  ): Promise<void> {
    let formattedPhone: string;
    
    try {
      formattedPhone = this.formatPhoneNumber(phoneNumber);
    } catch (error) {
      // Error de validación de número - NO enviar alerta
      this.logger.error(`❌ ERROR de validación para ${phoneNumber}: ${error.message}`);
      throw error;
    }

    try {
      let googleMapsUrl: string;
      let clinicName: string;
      let addressText = '';
      
      // Opción 1: Si tiene URL de Google Maps guardada, usarla
      if (clinic?.googleMapsUrl) {
        googleMapsUrl = clinic.googleMapsUrl;
        clinicName = clinic.medicalClinicName;
        addressText = clinic.address || '';
      } 
      // Opción 2: Si tiene coordenadas, generar URL
      else if (clinic?.latitude && clinic?.longitude) {
        googleMapsUrl = `https://maps.google.com/?q=${clinic.latitude},${clinic.longitude}`;
        clinicName = clinic.medicalClinicName;
        addressText = clinic.address || '';
      } 
      // Si no tiene ubicación, no enviar nada
      else {
        return;
      }

      // Construir mensaje con botón CTA URL (más elegante y profesional)
      const messageBody = addressText 
        ? `📍 *Te esperamos en:*\n\n🏥 ${clinicName}\n📫 ${addressText}\n\n🗺️ Presiona el botón para ver la ubicación en el mapa.`
        : `📍 *Te esperamos en:*\n\n🏥 ${clinicName}\n\n🗺️ Presiona el botón para ver la ubicación en el mapa.`;

      const payload: WhatsAppCTAUrlMessagePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: {
            text: messageBody,
          },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: 'Ver ubicacion',
              url: googleMapsUrl,
            },
          },
        },
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        this.logger.error(`❌ ERROR enviando botón de ubicación`);
        this.logger.error(`   └─ Status: ${response.status} ${response.statusText}`);
        this.logger.error(`   └─ Detalles: ${JSON.stringify(errorData, null, 2)}`);
        
        // Enviar alerta solo para errores de API
        await this.sendFailureAlert(
          'Ubicación de Clínica',
          phoneNumber,
          clinic?.medicalClinicName || 'Clínica',
          `Meta API Error [${response.status}]: ${JSON.stringify(errorData)}`,
        );
        
        throw new Error(`Meta API error: ${JSON.stringify(errorData)}`);
      }

      await response.json();
    } catch (error) {
      // Si ya es un error de Meta API, no enviar alerta de nuevo
      if (error.message?.includes('Meta API error')) {
        throw error;
      }
      
      // Error de red/timeout - enviar alerta
      this.logger.error(`❌ Error enviando botón de ubicación: ${error.message}`);
      await this.sendFailureAlert(
        'Ubicación de Clínica',
        phoneNumber,
        clinic?.medicalClinicName || 'Clínica',
        `Network/Timeout Error: ${error.message}`,
      );
      
      throw error;
    }
  }

  /**
   * Envía email de alerta a denteapp cuando falla el envío de WhatsApp
   */
  private async sendFailureAlert(
    errorType: string,
    phoneNumber: string,
    patientName: string,
    errorDetails: string,
  ): Promise<void> {
    try {
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #ef4444; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background-color: #f9f9f9; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
            .error-box { background-color: #fee2e2; padding: 15px; margin: 15px 0; border-left: 4px solid #ef4444; font-family: monospace; font-size: 12px; }
            .info-box { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #3b82f6; }
            .footer { text-align: center; margin-top: 20px; color: #777; font-size: 12px; }
            h2 { color: #ef4444; margin-top: 0; }
            strong { color: #2c3e50; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>❌ Error en Envío de WhatsApp</h1>
            </div>
            <div class="content">
              <p><strong>⚠️ Se detectó un problema al enviar un mensaje de WhatsApp</strong></p>
              
              <div class="info-box">
                <h2>📋 Información del Envío</h2>
                <p><strong>Tipo de error:</strong> ${errorType}</p>
                <p><strong>Paciente:</strong> ${patientName}</p>
                <p><strong>Número de teléfono:</strong> ${phoneNumber}</p>
                <p><strong>Fecha/Hora:</strong> ${new Date().toLocaleString('es-ES')}</p>
              </div>
              
              <div class="error-box">
                <h2>🔍 Detalles del Error</h2>
                <pre>${errorDetails}</pre>
              </div>
              
              <p><strong>Acción requerida:</strong> Verificar la configuración de WhatsApp API o el formato del número de teléfono.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} dente - Sistema de Notificaciones</p>
            </div>
          </div>
        </body>
        </html>
      `;

      await this.resend.emails.send({
        from: 'dente <facturacion@denteapp.com>',
        to: 'denteapp@gmail.com',
        subject: `❌ Error WhatsApp - ${errorType}`,
        html: emailHtml,
      });
    } catch (error) {
      this.logger.error(`❌ Error enviando alerta por email: ${error.message}`);
    }
  }

  /**
   * Formatea el número de teléfono para WhatsApp (elimina espacios, guiones, etc.)
   * Valida que el número tenga código de área
   */
  private formatPhoneNumber(phoneNumber: string): string {
    // Elimina espacios, guiones, paréntesis y puntos
    let formatted = phoneNumber.replace(/[\s\-\(\)\.]/g, '');

    // Validar que tenga al menos 10 dígitos (código país + número)
    const digitsOnly = formatted.replace(/\+/g, '');
    if (digitsOnly.length < 10) {
      throw new Error(`Número de teléfono inválido: ${phoneNumber}. Debe incluir código de área.`);
    }

    // Si no empieza con +, validar que tenga código de país
    if (!formatted.startsWith('+')) {
      // Si empieza con 504 (Honduras), agregar +
      if (formatted.startsWith('504')) {
        formatted = `+${formatted}`;
      } 
      // Si empieza con 0, reemplazar por código de país de Honduras
      else if (formatted.startsWith('0')) {
        formatted = formatted.replace(/^0/, '+504');
      } 
      // Si no tiene código reconocible, rechazar
      else {
        this.logger.warn(`⚠️ Número sin código de área: ${phoneNumber}`);
        throw new Error(`Número de teléfono inválido: ${phoneNumber}. Debe incluir código de área (ejemplo: +504).`);
      }
    }

    // Validar formato final: debe empezar con + y tener al menos 11 caracteres (+50412345678)
    if (!formatted.startsWith('+') || formatted.length < 11) {
      this.logger.warn(`⚠️ Formato de número inválido: ${phoneNumber} → ${formatted}`);
      throw new Error(`Número de teléfono con formato inválido: ${phoneNumber}`);
    }

    this.logger.debug(`✅ Número formateado: ${phoneNumber} → ${formatted}`);
    return formatted;
  }

  /**
   * Envía email de notificación cuando un paciente solicita reprogramar su cita
   */
  private async sendRescheduleEmail(
    appointment: AppointmentDocument,
    clinic: MedicalClinicDocument,
    patient: any,
  ): Promise<void> {
    try {
      const appointmentDate = new Date(appointment.start);
      const formattedDate = appointmentDate.toLocaleDateString('es-ES', { 
        weekday: 'long', 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      });
      const formattedTime = appointmentDate.toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });

      const patientName = patient?.firstName && patient?.lastName 
        ? `${patient.firstName} ${patient.lastName}` 
        : patient?.firstName || 'Paciente';

      const patientPhone = patient?.phoneNumber || 'Sin número';

      // Determinar destinatario del email
      let recipientEmail: string | null = null;
      let recipientName: string = '';

      // Opción 1: Si la clínica tiene email, usar ese
      if (clinic?.email) {
        recipientEmail = clinic.email;
        recipientName = clinic.medicalClinicName;
      } 
      // Opción 2: Buscar usuario admin de la clínica
      else {
        const adminUser = await this.userModel.findOne({
          medicalClinic: clinic._id,
          role: 'admin',
        }).exec();

        if (adminUser) {
          recipientEmail = adminUser.email;
          recipientName = `${adminUser.firstName} ${adminUser.lastName}`;
        }
      }

      if (!recipientEmail) {
        this.logger.warn(`⚠️ No se encontró email para notificar reprogramación de cita ${appointment._id}`);
        return;
      }

      // Construir HTML del email
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background-color: #f9f9f9; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
            .info-box { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #4CAF50; }
            .footer { text-align: center; margin-top: 20px; color: #777; font-size: 12px; }
            h2 { color: #4CAF50; margin-top: 0; }
            strong { color: #2c3e50; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📅 Solicitud de Reprogramación</h1>
            </div>
            <div class="content">
              <p>Hola <strong>${recipientName}</strong>,</p>
              
              <p>El paciente <strong>${patientName}</strong> ha solicitado reprogramar su cita a través de WhatsApp.</p>
              
              <div class="info-box">
                <h2>📋 Información de la Cita</h2>
                <p><strong>Paciente:</strong> ${patientName}</p>
                <p><strong>Teléfono:</strong> ${patientPhone}</p>
                <p><strong>Fecha original:</strong> ${formattedDate}</p>
                <p><strong>Hora original:</strong> ${formattedTime}</p>
                <p><strong>Clínica:</strong> ${clinic.medicalClinicName}</p>
              </div>
              
              <p><strong>⚠️ Acción requerida:</strong></p>
              <p>Por favor, ponte en contacto con el paciente lo antes posible para coordinar una nueva fecha y hora para la cita.</p>
              
              <p>Este email fue generado automáticamente por el sistema de recordatorios.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} dente - Sistema de Gestión de Citas</p>
            </div>
          </div>
        </body>
        </html>
      `;

      // Enviar email
      await this.resend.emails.send({
        from: 'dente <facturacion@denteapp.com>',
        to: recipientEmail,
        subject: `📅 Solicitud de Reprogramación - ${patientName}`,
        html: emailHtml,
      });
    } catch (error) {
      this.logger.error(`❌ Error enviando email de reprogramación: ${error.message}`);
    }
  }

  /**
   * Procesa actualizaciones de estado de mensajes desde webhook de WhatsApp
   * Actualiza el estado de lectura/entrega tanto en AuditoryNotificationsPatient como en Appointment
   * @param messageId - ID del mensaje de WhatsApp (wamid.xxx)
   * @param status - Estado del mensaje: 'delivered' | 'read'
   * @param recipientId - Número de teléfono del destinatario
   * @param timestamp - Timestamp del evento en formato Unix (segundos)
   */
  async handleMessageStatusUpdate(
    messageId: string,
    status: 'delivered' | 'read',
    recipientId: string,
    timestamp: string,
  ): Promise<void> {
    try {
      // 1️⃣ Buscar el registro de auditoría por externalId (messageId)
      const auditRecord = await this.auditoryNotifModel.findOne({ externalId: messageId });

      if (!auditRecord) {
        return;
      }

      // 2️⃣ Actualizar el registro de auditoría con el nuevo estado
      const eventDate = new Date(parseInt(timestamp) * 1000);
      const updateData: any = {};

      if (status === 'delivered') {
        updateData.status = 'entregado';
        updateData.deliveredAt = eventDate;
      } else if (status === 'read') {
        updateData.status = 'leido';
        updateData.readAt = eventDate;
        // Si aún no tiene deliveredAt, asumimos que se entregó en el mismo momento
        if (!auditRecord.deliveredAt) {
          updateData.deliveredAt = eventDate;
        }
      }

      await this.auditoryNotifModel.findByIdAndUpdate(auditRecord._id, updateData);

      // 3️⃣ Extraer appointmentId del metadata
      const appointmentId = auditRecord.metadata?.appointmentId;

      if (!appointmentId) {
        return;
      }

      // Verificar si es un recordatorio (solo actualizar appointment para recordatorios)
      const notificationType = auditRecord.notificationType?.toLowerCase() || '';
      const isReminder = notificationType === 'reminder' || 
                         notificationType.includes('reminder');
      
      if (!isReminder) {
        // Es confirmación/cancelación - solo se actualizó AuditoryNotificationsPatient
        return;
      }

      // 4️⃣ Actualizar el array notificationsSent en Appointment (solo para recordatorios)
      const appointment = await this.appointmentModel.findById(appointmentId);

      if (!appointment) {
        return;
      }

      // Buscar la notificación específica en el array por messageId
      const notificationIndex = appointment.notificationsSent.findIndex(
        (notif: any) => notif.messageId === messageId
      );

      if (notificationIndex === -1) {
        return;
      }

      // Actualizar el elemento específico del array
      const updatePath: any = {};
      
      if (status === 'delivered') {
        updatePath[`notificationsSent.${notificationIndex}.status`] = 'entregado';
        updatePath[`notificationsSent.${notificationIndex}.deliveredAt`] = eventDate;
      } else if (status === 'read') {
        updatePath[`notificationsSent.${notificationIndex}.status`] = 'leido';
        updatePath[`notificationsSent.${notificationIndex}.readAt`] = eventDate;
        // Si no tiene deliveredAt, agregarlo también
        if (!appointment.notificationsSent[notificationIndex].deliveredAt) {
          updatePath[`notificationsSent.${notificationIndex}.deliveredAt`] = eventDate;
        }
      }

      await this.appointmentModel.findByIdAndUpdate(appointmentId, { $set: updatePath });
      this.logger.log(`   🎯 Estado final: ${status === 'delivered' ? 'Mensaje entregado' : 'Mensaje leído por el paciente'}`);
      this.logger.log(`${'='.repeat(80)}\n`);

    } catch (error) {
      this.logger.error(`❌ Error procesando actualización de estado de mensaje:`);
      this.logger.error(`   └─ Message ID: ${messageId}`);
      this.logger.error(`   └─ Error: ${error.message}`);
      this.logger.error(`   └─ Stack: ${error.stack}`);
      this.logger.log(`${'='.repeat(80)}\n`);
      // No lanzar error - el webhook debe retornar 200 siempre
    }
  }
}



