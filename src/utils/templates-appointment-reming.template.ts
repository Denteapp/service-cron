import mjml2html = require('mjml');
import * as fs from 'fs';
import * as path from 'path';

type TemplateData = {
  name: string;
  date: string;
  clinicName: string;
  clinicAddress: string;
  clinicPhone: string;
  clinicEmail: string;
  clinicLogoUrl: string;
  confirmUrl: string;
  rescheduleUrl: string;
  cancelUrl: string;
  avatar: string;
};

export function renderAppointmentReminderMJML(data: TemplateData): string {
  const filePath = path.join(process.cwd(), 'src', 'scheduler', 'templates', 'appointment-reminder.mjml');
  const mjmlTemplate = fs.readFileSync(filePath, 'utf-8');

  // Reemplazo de todos los placeholders en la plantilla
  const filledTemplate = mjmlTemplate
    .replace(/{{name}}/g, data.name)
    .replace(/{{date}}/g, data.date)
    .replace(/{{clinicName}}/g, data.clinicName)
    .replace(/{{clinicAddress}}/g, data.clinicAddress)
    .replace(/{{clinicPhone}}/g, data.clinicPhone)
    .replace(/{{clinicEmail}}/g, data.clinicEmail)
    .replace(/{{clinicLogoUrl}}/g, data.clinicLogoUrl)
    .replace(/{{confirmUrl}}/g, data.confirmUrl)
    .replace(/{{rescheduleUrl}}/g, data.rescheduleUrl)
    .replace(/{{cancelUrl}}/g, data.cancelUrl)
    .replace(/{{avatar}}/g, data.avatar)

  const { html, errors } = mjml2html(filledTemplate);

  if (errors.length > 0) {
    console.error('Errores al compilar MJML:', errors);
  }

  return html;
}
