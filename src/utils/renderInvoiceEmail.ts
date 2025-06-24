import mjml2html = require('mjml');
import * as fs from 'fs';
import * as path from 'path';

type InvoiceData = {
  medicalClinic: string;
  user: string;
  amount: number;
  transactionID: string;
  bankName: string;
  paymentState: number;
  externalReference: string;
  holderName: string;
  recipientImg: string;
  description: string;
  paymentMethod: string;
  last4Digits: string;
  transferDate: string;
  period: string;
  isAutomatic: boolean;
  generatedBy: string;
  issuedDate: string;
  billingCycle: string;
  displayStatus: string;
  _id: string;
  createdAt: string;
  updatedAt: string;
};

type ClinicData = {
  avatar: string;
  _id: string;
  medicalClinicName: string;
  expiredSubsDate: string;
  plan: number;
  country: string;
  licenceUser: number;
  adminEmails: string[];
  adminNames: string[];
};

type InvoiceTemplateData = {
  invoice: InvoiceData;
  clinic: ClinicData;
  isSecondUnpaidInvoice: boolean;
  unpaidCount: number;
  paymentUrl?: string;
  viewInvoiceUrl?: string;
  supportUrl?: string;
  logoUrl?: string;
  companyName?: string;
  supportEmail?: string;
  supportPhone?: string;
  websiteUrl?: string;
};

export function renderInvoiceEmailMJML(data: InvoiceTemplateData): string {
  // console.log(data);
  
  const filePath = path.join(process.cwd(), 'src', 'invoices', 'templates', 'invoice-created-notification.mjml');
  const mjmlTemplate = fs.readFileSync(filePath, 'utf-8');

  const formatDate = (dateString: string): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-HN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      // hour: '2-digit',
      // minute: '2-digit',
    });
  };

  const formatAmount = (amount: number): string => {
    if (amount == null) return '';
    return amount.toLocaleString('es-HN', {
      style: 'currency',
      currency: 'HNL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const getPlanName = (plan: number): string => {
    const plans: Record<number, string> = {
      1: 'Plan Inicial',
      2: 'Plan Profesional',
      3: 'Plan Premium',
      4: 'Plan Enterprise',
    };
    return plans[plan] || `Plan ${plan}`;
  };

  const defaultUrls = {
    paymentUrl: data.paymentUrl || '#',
    viewInvoiceUrl: data.viewInvoiceUrl || '#',
    supportUrl: data.supportUrl || 'https://denteapp.com',
    logoUrl: data.logoUrl || 'https://via.placeholder.com/120x40/667eea/ffffff?text=DENTE',
    companyName: data.companyName || 'dente',
    supportEmail: data.supportEmail || 'soporte@denteaoo.com',
    supportPhone: data.supportPhone || '+504 3398-0220',
    websiteUrl: data.websiteUrl || 'denteapp.com',
  };

  const clinic = data.clinic || {
    _id: '',
    medicalClinicName: data.invoice?.holderName || 'Nombre Clínica',
    adminNames: ['Administrador'],
    expiredSubsDate: '',
    plan: 1,
    licenceUser: 0,
    avatar: '',
    country: '',
    adminEmails: [],
  };

  const invoice = data.invoice || {
    medicalClinic: '',
    user: '',
    amount: 0,
    transactionID: '',
    bankName: '',
    paymentState: 0,
    externalReference: '',
    holderName: '',
    recipientImg: '',
    description: '',
    paymentMethod: '',
    last4Digits: '',
    transferDate: '',
    period: '',
    isAutomatic: false,
    generatedBy: '',
    issuedDate: '',
    billingCycle: '',
    displayStatus: '',
    _id: '',
    createdAt: '',
    updatedAt: '',
  };

  const filledTemplate = mjmlTemplate
    // Clínica
    .replace(/{{clinic\.medicalClinicName}}/g, clinic.medicalClinicName)
    .replace(/{{clinic\.adminNames\[0\]}}/g, clinic.adminNames?.[0] || 'Administrador')
    .replace(/{{clinic\.expiredSubsDate}}/g, formatDate(clinic.expiredSubsDate))
    .replace(/{{clinic\.plan}}/g, getPlanName(clinic.plan))
    .replace(/{{clinic\.avatar}}/g, clinic.avatar)
    .replace(/{{clinic\.licenceUser}}/g, clinic.licenceUser.toString())
    .replace(/{{clinic\.country}}/g, clinic.country)
    // Factura
    .replace(/{{invoice\.transactionID}}/g, invoice.transactionID)
    .replace(/{{invoice\.externalReference}}/g, invoice.externalReference)
    .replace(/{{invoice\.period}}/g, invoice.period)
    .replace(/{{invoice\.billingCycle}}/g, invoice.billingCycle)
    .replace(/{{invoice\.paymentMethod}}/g, invoice.paymentMethod)
    .replace(/{{invoice\.issuedDate}}/g, formatDate(invoice.issuedDate))
    .replace(/{{invoice\.amount}}/g, formatAmount(invoice.amount))
    .replace(/{{invoice\.displayStatus}}/g, invoice.displayStatus)
    .replace(/{{invoice\.description}}/g, invoice.description)
    .replace(/{{invoice\.holderName}}/g, invoice.holderName)
    .replace(/{{invoice\.generatedBy}}/g, invoice.generatedBy)
    .replace(/{{invoice\.transferDate}}/g, formatDate(invoice.transferDate))
    // URLs y otros
    .replace(/{{paymentUrl}}/g, defaultUrls.paymentUrl)
    .replace(/{{viewInvoiceUrl}}/g, defaultUrls.viewInvoiceUrl)
    .replace(/{{supportUrl}}/g, defaultUrls.supportUrl)
    .replace(/{{logoUrl}}/g, defaultUrls.logoUrl)
    .replace(/{{companyName}}/g, defaultUrls.companyName)
    .replace(/{{supportEmail}}/g, defaultUrls.supportEmail)
    .replace(/{{supportPhone}}/g, defaultUrls.supportPhone)
    .replace(/{{websiteUrl}}/g, defaultUrls.websiteUrl)
    // Otros datos
    .replace(/{{unpaidCount}}/g, data.unpaidCount?.toString() || '0')
    .replace(/{{isSecondUnpaidInvoice}}/g, (data.isSecondUnpaidInvoice ? 'true' : 'false'));

  const { html, errors } = mjml2html(filledTemplate);

  if (errors.length > 0) {
    console.error('Errores al compilar MJML de factura:', errors);
    errors.forEach(error => {
      console.error(`- ${error.formattedMessage}`);
    });
  }

  return html;
}