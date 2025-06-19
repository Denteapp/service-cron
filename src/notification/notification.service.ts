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
  clinic: SuspensionData;
  gracePeriodDays: number;
  suspensionReason: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly resend = new Resend('re_Gra27vCZ_jHqBkANeJViMvoqyc8GMuNqt');

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
      this.logger.log(`✅ Notificación de factura enviada a ${email}`);
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
  async sendSuspensionNotification(email: string, data: SuspensionNotificationData): Promise<void> {
    try {
// this.logger.log(`📧 Enviando notificación de suspensión a ${email}`);
this.logger.log(`📧 Enviando notificación de suspensión a ${email}`);

// Transform SuspensionNotificationData to SuspensionTemplateData
 
// Render the email template
const emailHtml = renderSuspensionEmailMJML(data as any);

// console.log(emailHtml);
      

      // Send the email
      const result = await this.resend.emails.send({
        from: 'dente <notification-no-reply@denteapp.com>',
        to: email,
        subject: `Suspención temporal de servicio`,
        html: emailHtml,
      });

      if (result.error) throw new Error(result.error.message);
      this.logger.log(`✅ Notificación de suspensión enviada a ${email}`);
    } catch (error) {
      this.logger.error(`❌ Error enviando notificación de suspensión a ${email}: ${error.message}`);
      throw error;
    }
  }
}


// import { Injectable, Logger } from '@nestjs/common';
// import { Resend } from 'resend';
// import { renderSuspensionEmailMJML } from 'src/utils/render-suspendEmail';
// import { renderInvoiceEmailMJML } from 'src/utils/renderInvoiceEmail';
// // Si llegas a crear plantillas específicas, importa sus helpers:
// // import { renderReminderEmailMJML } from 'src/utils/renderReminderEmail';
// // import { renderRiskEmailMJML } from 'src/utils/renderRiskEmail';
// // import { renderSuspensionEmailMJML } from 'src/utils/renderSuspensionEmail';

// interface SuspensionNotificationData {
//   message: string;
//   clinic: {
//     clinicId: string;
//     clinicName: string;
//     clinicEmail?: string;
//     unpaidCount: number;
//     daysOverdue: number;
//     adminNames: string[];
//     adminEmails: string[];
//   };
//   gracePeriodDays: number;
//   suspensionReason: string;
// }

// type SuspensionInvoiceInfo = {
//   createdAt: Date | string; // Acepta tanto Date como string
//   period: string;
//   comment?: string;
//   displayComment: string;
// };

// type ClinicDetails = {
//   country: string;
//   plan: number;
//   avatar: string;
//   licenceUser: number;
//   expiredSubsDate: Date | string; // Acepta tanto Date como string
// };

// type SuspensionData = {
//   clinicId: string;
//   clinicName: string;
//   clinicEmail?: string;
//   adminEmails: string[];
//   adminNames: string[];
//   shouldSuspend: boolean;
//   daysOverdue: number;
//   secondInvoiceInfo: SuspensionInvoiceInfo;
//   unpaidCount: number;
//   clinicDetails: ClinicDetails;
// };

// type SuspensionTemplateData = {
//   clinic: SuspensionData;
//   paymentUrl?: string;
//   supportUrl?: string;
//   logoUrl?: string;
//   companyName?: string;
//   supportEmail?: string;
//   supportPhone?: string;
//   supportWhatsApp?: string;
//   websiteUrl?: string;
//   astroUrl?: string;
//   instagramUrl?: string;
//   facebookUrl?: string;
// };
// @Injectable()
// export class NotificationService {
//   private readonly logger = new Logger(NotificationService.name);

//   /**
//    * Instancia del SDK de Resend.
//    * ⚠️ Reemplaza process.env.RESEND_API_KEY con la forma
//    * en que almacenes tus secrets en producción.
//    */
//   private readonly resend = new Resend('re_Gra27vCZ_jHqBkANeJViMvoqyc8GMuNqt');

//   /* ----------------------------------------------------------------
//    * 1️⃣  AVISO DE NUEVA FACTURA (F1 o F2)
//    * ---------------------------------------------------------------- */
//   async sendInvoiceNotification(email: string, invoice: any): Promise<void> {
//     /**
//      * Se ejecuta en cuanto se genera la factura.
//      * – Para F1 es un aviso normal.
//      * – Para F2 debería incluir un copy que deje claro
//      *   que es la última oportunidad antes de suspensión.
//      */
//     try {
//       const html = renderInvoiceEmailMJML(invoice);

//       const result = await this.resend.emails.send({
//         from: 'dente <facturacion@denteapp.com>',
//         to: email,
//         ...(invoice.clinic?.email && { cc: invoice.clinic.email }),
//         subject: `Factura disponible · Período: ${invoice.invoice.period} | dente Software Odontológico`,
//         html,
//       });

//       if (result.error) throw new Error(result.error.message);

//       this.logger.log(`✅ Notificación de factura enviada a ${email}`);
//     } catch (error) {
//       this.logger.error(`❌ Error enviando notificación de factura a ${email}:`, error.message);
//       throw error;
//     }
//   }

//   /* ----------------------------------------------------------------
//    * 2️⃣  RECORDATORIO (Día 2 o 3 tras F2)
//    * ---------------------------------------------------------------- */
//   async sendPaymentReminder(email: string, invoice: any, daysOverdue: number): Promise<void> {
//     /**
//      * Llamar cuando la factura (F1 o F2) tiene X días vencida.
//      * Útil para los “recordatorios suaves/fuertes”.
//      */
//     try {
//       // const html = renderReminderEmailMJML(invoice, daysOverdue);
//       // const html = `
//       //   <p>Tu factura está vencida hace <b>${daysOverdue} día(s)</b>.</p>
//       //   <p>Para evitar la suspensión del servicio, ingresa a tu panel y realiza el pago.</p>
//       // `;

//       // const result = await this.resend.emails.send({
//       //   from: 'dente <facturacion@denteapp.com>',
//       //   to: email,
//       //   subject: `Recordatorio: factura vencida · dente`,
//       //   html,
//       // });

//       // if (result.error) throw new Error(result.error.message);

//       this.logger.log(`✅ Recordatorio de pago enviado a ${email}`);
//     } catch (error) {
//       this.logger.error(`❌ Error enviando recordatorio a ${email}:`, error.message);
//       throw error;
//     }
//   }

//   /* ----------------------------------------------------------------
//    * 3️⃣  AVISO DE “EN RIESGO” (2 facturas impagas, antes de suspender)
//    * ---------------------------------------------------------------- */
//   async sendRiskNotification(email: string, graceLimitDays: number): Promise<void> {
//     /**
//      * Llamar justo después de generar F2 o cuando falten
//      * ≤ 24 h para llegar al límite de suspensión.
//      */
//     try {
//       // const html = renderRiskEmailMJML(graceLimitDays);
//       // const html = `
//       //   <h3>⚠️ Tu cuenta está en riesgo de suspensión</h3>
//       //   <p>Registramos dos facturas impagas. Si no recibimos tu pago
//       //   en las próximas <b>${graceLimitDays} horas</b>, tu cuenta será suspendida.</p>
//       // `;

//       // const result = await this.resend.emails.send({
//       //   from: 'dente <facturacion@denteapp.com>',
//       //   to: email,
//       //   subject: '⚠️ Último aviso antes de suspensión · dente',
//       //   html,
//       // });

//       // if (result.error) throw new Error(result.error.message);

//       this.logger.log(`✅ Aviso de riesgo enviado a ${email}`);
//     } catch (error) {
//       this.logger.error(`❌ Error enviando aviso de riesgo a ${email}:`, error.message);
//       throw error;
//     }
//   }

//   /* ----------------------------------------------------------------
//    * 4️⃣  NOTIFICACIÓN DE SUSPENSIÓN
//    * ---------------------------------------------------------------- */
//   async sendSuspensionNotification(email: string, data: SuspensionNotificationData): Promise<void> {
//     try {
//       this.logger.log(`📧 Enviando notificación de suspensión a ${email}`);
//       // this.logger.log(`📧 Clinica Notificacion ${JSON.stringify(data)}`);

//       const dataFinal = data
//       this.logger.log(`📧 Enviando data Suspendida ${JSON.stringify(dataFinal)}`);

//       function transformSuspensionData(rawData: any): SuspensionTemplateData {
//         return {
//           clinic: {
//             clinicId: rawData.clinicId,
//             clinicName: rawData.clinicName,
//             clinicEmail: rawData.clinicEmail, // Opcional
//             adminEmails: rawData.adminEmails,
//             adminNames: rawData.adminNames,
//             shouldSuspend: rawData.shouldSuspend,
//             daysOverdue: rawData.daysOverdue,
//             secondInvoiceInfo: {
//               createdAt: new Date(rawData.secondInvoiceInfo.createdAt), // Convertir string a Date
//               period: rawData.secondInvoiceInfo.period,
//               comment: rawData.secondInvoiceInfo.comment,
//               displayComment: rawData.secondInvoiceInfo.displayComment,
//             },
//             unpaidCount: rawData.unpaidCount,
//             clinicDetails: {
//               country: rawData.clinicDetails.country,
//               plan: rawData.clinicDetails.plan,
//               avatar: rawData.clinicDetails.avatar,
//               licenceUser: rawData.clinicDetails.licenceUser,
//               expiredSubsDate: new Date(rawData.clinicDetails.expiredSubsDate), // Convertir string a Date
//             },
//           },
//         };
//       }

//       const finalData = transformSuspensionData(dataFinal)

//       // const emailHtml = renderSuspensionEmailMJML(email, finalData);

//       console.log(finalData);

//       // const html = `
//       //   <h2>🚫 Cuenta suspendida</h2>
//       //   <p>Motivo: <strong>${reason}</strong></p>
//       //   <p>Para reactivar tu servicio, liquida las facturas pendientes
//       //   desde tu panel de administración.</p>
//       // `;

//       // const result = await this.resend.emails.send({
//       //   from: 'dente <facturacion@denteapp.com>',
//       //   to: email,
//       //   subject: '🚫 Suspensión de cuenta · dente',
//       //   html,
//       // });

//       // if (result.error) throw new Error(result.error.message);

//       this.logger.log(`✅ Notificación de suspensión enviada a ${email}`);
//     } catch (error) {
//       this.logger.error(`❌ Error enviando notificación de suspensión a ${email}: ${error.message}`, );
//       throw error;
//     }
//   }
// }


// // import { Injectable, Logger } from '@nestjs/common';
// // import { Resend } from 'resend';
// // import { renderInvoiceEmailMJML } from 'src/utils/renderInvoiceEmail';

// // @Injectable()
// // export class NotificationService {
// //   private readonly logger = new Logger(NotificationService.name);

// //   private readonly resend = new Resend('re_Gra27vCZ_jHqBkANeJViMvoqyc8GMuNqt');

// //   async sendInvoiceNotification(email: string, invoice: any): Promise<void> {

// //     try {

// //       const html = renderInvoiceEmailMJML(invoice);

// //       const result = await this.resend.emails.send({
// //         from: 'dente <facturacion@denteapp.com>',
// //         to: email,
// //         ...(invoice.clinic.email && { cc: invoice.clinic.email }),
// //         subject: `Factura disponible P: ${invoice.invoice.period}| dente Software Odontológico`,
// //         html
// //       });

// //       if (result.error) {
// //         throw new Error(result.error.message);
// //       }

// //       this.logger.log(`✅ Notificación enviada exitosamente a ${email}`);
// //     } catch (error) {
// //       this.logger.error(`❌ Error enviando notificación a ${email}:`, error.message);
// //       throw error;
// //     }
// //   }

// //   async sendSuspensionNotification(email: string, reason: string): Promise<void> {
// //     try {
// //       this.logger.log(`📧 Enviando notificación de suspensión a ${email}`);

// //       const result = await this.resend.emails.send({
// //         from: 'dente <facturacion@denteapp.com>',
// //         to: email,
// //         subject: '🚫 Suspensión de cuenta',
// //         html: `<p>Su cuenta ha sido suspendida por el siguiente motivo:</p><p><strong>${reason}</strong></p>`,
// //       });

// //       if (result.error) {
// //         throw new Error(result.error.message);
// //       }

// //       this.logger.log(`✅ Notificación de suspensión enviada a ${email}`);
// //     } catch (error) {
// //       this.logger.error(`❌ Error enviando notificación de suspensión a ${email}:`, error.message);
// //       throw error;
// //     }
// //   }


// // }
