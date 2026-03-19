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
  plan: string | number; // String desde Subscription.planName o number legacy
  country: string;
  licenceUser: number;
  adminEmails: string[];
  adminNames: string[];
};

type BillingBreakdown = {
  planName: string;
  basePrice: number;
  additionalUsers: number;
  additionalUserPrice: number;
  additionalUsersTotal: number;
  total: number;
  currency: string; // USD, HNL, etc.
};

type InvoiceTemplateData = {
  invoice: InvoiceData;
  clinic: ClinicData;
  billing?: BillingBreakdown; // Desglose de costos
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

  const formatAmount = (amount: number, currency: string = 'HNL'): string => {
    if (amount == null) return '';
    
    // Mapeo de locales según moneda
    const localeMap: Record<string, string> = {
      'USD': 'en-US',
      'HNL': 'es-HN',
      'MXN': 'es-MX',
      'GTQ': 'es-GT',
      'CRC': 'es-CR',
    };
    
    const locale = localeMap[currency.toUpperCase()] || 'es-HN';
    
    return amount.toLocaleString(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const getPlanName = (plan: string | number): string => {
    // Si ya es string (desde Subscription.planName), devolverlo directamente
    if (typeof plan === 'string') {
      return plan.startsWith('Plan ') ? plan : `Plan ${plan}`;
    }
    // Legacy: si es número (desde MedicalClinic.plan obsoleto)
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

  const clinic = data.clinic || {
    _id: '',
    medicalClinicName: invoice.holderName || 'Nombre Clínica',
    adminNames: ['Administrador'],
    expiredSubsDate: '',
    plan: 1,
    licenceUser: 0,
    avatar: '',
    country: '',
    adminEmails: [],
  };

  // Preparar desglose de facturación con valores por defecto
  const billing = data.billing || {
    planName: 'Inicial',
    basePrice: 0,
    additionalUsers: 0,
    additionalUserPrice: 0,
    additionalUsersTotal: 0,
    total: invoice.amount || 0,
    currency: 'HNL',
  };

  const filledTemplate = mjmlTemplate
    // Clínica
    .replace(/{{clinic\.medicalClinicName}}/g, clinic.medicalClinicName || 'Clínica')
    .replace(/{{clinic\.adminNames\[0\]}}/g, clinic.adminNames?.[0] || 'Administrador')
    .replace(/{{clinic\.expiredSubsDate}}/g, formatDate(clinic.expiredSubsDate))
    .replace(/{{clinic\.plan}}/g, getPlanName(clinic.plan))
    .replace(/{{clinic\.avatar}}/g, clinic.avatar || '')
    .replace(/{{clinic\.licenceUser}}/g, (clinic.licenceUser || 1).toString())
    .replace(/{{clinic\.country}}/g, clinic.country || 'HN')
    // Factura
    .replace(/{{invoice\.transactionID}}/g, invoice.transactionID)
    .replace(/{{invoice\.externalReference}}/g, invoice.externalReference)
    .replace(/{{invoice\.period}}/g, invoice.period)
    .replace(/{{invoice\.billingCycle}}/g, invoice.billingCycle)
    .replace(/{{invoice\.paymentMethod}}/g, invoice.paymentMethod)
    .replace(/{{invoice\.issuedDate}}/g, formatDate(invoice.issuedDate))
    .replace(/{{invoice\.amount}}/g, formatAmount(invoice.amount, billing.currency))
    .replace(/{{invoice\.displayStatus}}/g, invoice.displayStatus)
    .replace(/{{invoice\.description}}/g, invoice.description)
    .replace(/{{invoice\.holderName}}/g, invoice.holderName)
    .replace(/{{invoice\.generatedBy}}/g, invoice.generatedBy)
    .replace(/{{invoice\.transferDate}}/g, formatDate(invoice.transferDate))
    // Desglose de facturación
    .replace(/{{billing\.planName}}/g, billing.planName)
    .replace(/{{billing\.basePrice}}/g, formatAmount(billing.basePrice, billing.currency))
    .replace(/{{billing\.additionalUsers}}/g, billing.additionalUsers.toString())
    .replace(/{{billing\.additionalUserPrice}}/g, formatAmount(billing.additionalUserPrice, billing.currency))
    .replace(/{{billing\.additionalUsersTotal}}/g, formatAmount(billing.additionalUsersTotal, billing.currency))
    .replace(/{{billing\.total}}/g, formatAmount(billing.total, billing.currency))
    .replace(/{{billing\.currency}}/g, billing.currency)
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