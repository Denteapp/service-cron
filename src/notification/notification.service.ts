import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { renderSuspensionEmailMJML } from 'src/utils/render-suspendEmail';
import { renderInvoiceEmailMJML } from 'src/utils/renderInvoiceEmail';

// Types for Suspension Notification
type SuspensionInvoiceInfo = {
  createdAt: Date | string;
  period: string;
  comment?: string;
  amount: number;
  displayComment: string;
};

type ClinicDetails = {
  country: string;
  plan: number;
  avatar: string;
  licenceUser: number;
  expiredSubsDate: Date | string;
};

export type SuspensionData = {
  clinicId: string;
  clinicName: string;
  clinicEmail?: string;
  adminEmails: string[];
  adminNames: string[];
  shouldSuspend: boolean;
  daysOverdue: number;
  secondInvoiceInfo: SuspensionInvoiceInfo;
  unpaidCount: number;
  clinicDetails: ClinicDetails;
};

export type SuspensionTemplateData = {
  clinic: SuspensionData;
  paymentUrl?: string;
  supportUrl?: string;
  logoUrl?: string;
  companyName?: string;
  supportEmail?: string;
  supportPhone?: string;
  supportWhatsApp?: string;
  websiteUrl?: string;
  astroUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
};

interface SuspensionNotificationData {
  clinicDetails: ClinicDetails;
  secondInvoiceInfo: any;
  message: string;
  clinicEmail?: string;
  clinic: SuspensionData;
  gracePeriodDays: number;
  suspensionReason: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);

  /* ----------------------------------------------------------------
   * 1️⃣  AVISO DE NUEVA FACTURA (F1 o F2)
   * ---------------------------------------------------------------- */
  async sendInvoiceNotification(email: string, invoice: any): Promise<void> {
    try {
      const html = renderInvoiceEmailMJML(invoice);
      const result = await this.resend.emails.send({
        from: 'dente <facturacion@denteapp.com>',
        to: email,
        ...(invoice.clinic?.email && { cc: invoice.clinic.email }),
        subject: `Facturación · Período: ${invoice.invoice.period}`,
        html,
      });

      if (result.error) throw new Error(result.error.message);
      // this.logger.log(`✅ Notificación de factura enviada a ${email}`);
    } catch (error) {
      this.logger.error(`❌ Error enviando notificación de factura a ${email}:`, error.message);
      throw error;
    }
  }

  /* ----------------------------------------------------------------
   * 2️⃣  RECORDATORIO (Día 2 o 3 tras F2)
   * ---------------------------------------------------------------- */
  async sendPaymentReminder(email: string, invoice: any, daysOverdue: number): Promise<void> {
    try {
      this.logger.log(`✅ Recordatorio de pago enviado a ${email}`);
    } catch (error) {
      this.logger.error(`❌ Error enviando recordatorio a ${email}:`, error.message);
      throw error;
    }
  }

  /* ----------------------------------------------------------------
   * 3️⃣  AVISO DE "EN RIESGO" (2 facturas impagas, antes de suspender)
   * ---------------------------------------------------------------- */
  async sendRiskNotification(email: string, graceLimitDays: number): Promise<void> {
    try {
      this.logger.log(`✅ Aviso de riesgo enviado a ${email}`);
    } catch (error) {
      this.logger.error(`❌ Error enviando aviso de riesgo a ${email}:`, error.message);
      throw error;
    }
  }

  /* ----------------------------------------------------------------
   * 4️⃣  NOTIFICACIÓN DE SUSPENSIÓN
   * ---------------------------------------------------------------- */
async sendSuspensionNotification(email: string[], data: SuspensionNotificationData ): Promise<void> {
    try {
      this.logger.log(`📧 Enviando notificación de suspensión a ${email}`);
      // this.logger.log(`${JSON.stringify(data)}`);

      // Transform SuspensionNotificationData to SuspensionTemplateData
      const emailHtml = renderSuspensionEmailMJML(data as any);

      // Prepare email options
      const emailOptions: any = {
        from: 'dente <notification-no-reply@denteapp.com>',
        to: email,
        subject: `⚠️ Importante: Facturas pendientes - Evitá la suspensión`,
        html: emailHtml,
      };

      // Add CC if clinicEmail is provided and not empty
      if (data.clinicEmail && data.clinicEmail.trim() !== '') {
        emailOptions.cc = data.clinicEmail;
        this.logger.log(`✉️ Se agregó copia a: ${data.clinicEmail}`);
      }

      // // Send the email
      const result = await this.resend.emails.send(emailOptions);
      if (result.error) throw new Error(result.error.message);

      this.logger.log(`✅ Notificación de suspensión enviada a ${email}`);
    } catch (error) {
      this.logger.error(`❌ Error enviando notificación de suspensión a ${email}: ${error.message}`);
      throw error;
    }
  }
}

