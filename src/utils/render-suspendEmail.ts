import mjml2html = require('mjml');
import * as fs from 'fs';
import * as path from 'path';
import { differenceInDays, format, parseISO, isAfter, isBefore, addDays } from 'date-fns';
import { es } from 'date-fns/locale';

type SuspensionData = {
  clinicId: string;
  clinicName: string;
  clinicEmail: string;
  adminEmails: string[];
  adminNames: string[];
  shouldSuspend: boolean;
  daysOverdue: number;
  firstInvoiceInfo: {
    createdAt: Date;
    period: string;
    amount: number;
    comment: string;
    displayComment: string;
  };
  secondInvoiceInfo: {
    createdAt: Date;
    period: string;
    amount: number;
    comment: string;
    displayComment: string;
  };
  unpaidCount: number;
  clinicDetails: {
    country: string;
    plan: number;
    avatar: string;
    licenceUser: number;
    expiredSubsDate: Date;
  };
};

type SuspensionTemplateData = {
  suspension: SuspensionData;
  paymentUrl?: string;
  supportUrl?: string;
  logoUrl?: string;
  companyName?: string;
  supportEmail?: string;
  supportPhone?: string;
  websiteUrl?: string;
};

export function renderSuspensionEmailMJML(data: SuspensionTemplateData | SuspensionData): string {
  console.log('Rendering suspension email with data:', data);
  
  // Verificar si los datos vienen directamente o envueltos en 'suspension'
  // Corregir la lógica de extracción
  let suspension: SuspensionData;
  let templateData: SuspensionTemplateData;
  
  if ('suspension' in data) {
    // Los datos vienen como SuspensionTemplateData
    suspension = data.suspension;
    templateData = data;
  } else {
    // Los datos vienen directamente como SuspensionData
    suspension = data;
    templateData = {
      suspension: data,
      paymentUrl: 'https://portal.denteapp.com/payment',
      supportUrl: 'https://denteapp.com/support',
      logoUrl: 'https://res.cloudinary.com/dente/image/upload/v1634436472/imagesStatic/Logo_Dente_Colores_cvutxk.png',
      companyName: 'Dente',
      supportEmail: 'soporte@denteapp.com',
      supportPhone: '+504 8893-0220',
      websiteUrl: 'denteapp.com',
    };
  }
  
  if (!suspension || !suspension.clinicDetails) {
    throw new Error('Los datos de suspensión son inválidos o están incompletos');
  }
  
  console.log('Suspension data extracted:', suspension);
  
  // Ruta al template MJML de suspensión
  const filePath = path.join(process.cwd(), 'src', 'invoices', 'templates', 'suspend-service-notification.mjml');
  const mjmlTemplate = fs.readFileSync(filePath, 'utf-8');

  const formatDate = (dateString: string | Date): string => {
    if (!dateString) return '';
    try {
      const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
      return format(date, 'dd/MM/yyyy', { locale: es });
    } catch (error) {
      console.error('Error formatting date:', error);
      return '';
    }
  };

  const formatDateWithTime = (dateString: string | Date): string => {
    if (!dateString) return '';
    try {
      const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
      return format(date, "dd/MM/yyyy 'a las' HH:mm", { locale: es });
    } catch (error) {
      console.error('Error formatting date with time:', error);
      return '';
    }
  };

  const formatDateLong = (dateString: string | Date): string => {
    if (!dateString) return '';
    try {
      const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
      return format(date, "dd 'de' MMMM 'de' yyyy", { locale: es });
    } catch (error) {
      console.error('Error formatting long date:', error);
      return '';
    }
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

  const calculateDaysRemaining = (expiredDate: Date): { days: number; text: string; isExpired: boolean } => {
    if (!expiredDate) return { days: 0, text: '0 días', isExpired: true };
    
    try {
      const now = new Date();
      const expired = typeof expiredDate === 'string' ? parseISO(expiredDate) : expiredDate;
      const diffDays = differenceInDays(expired, now);
      
      if (diffDays < 0) {
        return { 
          days: diffDays, 
          text: `${Math.abs(diffDays)} días vencido`, 
          isExpired: true 
        };
      } else if (diffDays === 0) {
        return { days: 0, text: 'Vence hoy', isExpired: true };
      } else {
        return { 
          days: diffDays, 
          text: `${diffDays} días restantes`, 
          isExpired: false 
        };
      }
    } catch (error) {
      console.error('Error calculating days remaining:', error);
      return { days: 0, text: 'Error en fecha', isExpired: true };
    }
  };

  const calculateDaysBetween = (date1: Date, date2: Date): number => {
    if (!date1 || !date2) return 0;
    try {
      const d1 = typeof date1 === 'string' ? parseISO(date1) : date1;
      const d2 = typeof date2 === 'string' ? parseISO(date2) : date2;
      return Math.abs(differenceInDays(d2, d1));
    } catch (error) {
      console.error('Error calculating days between dates:', error);
      return 0;
    }
  };

  

function formatCurrency(amount: number, locale = 'es-HN', currency = 'HNL'): string {
  return amount.toLocaleString(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
  // URLs y configuraciones por defecto
  const defaultUrls = {
    paymentUrl: templateData.paymentUrl || 'https://portal.denteapp.com/payment',
    supportUrl: templateData.supportUrl || 'https://denteapp.com/support',
    logoUrl: templateData.logoUrl || 'https://res.cloudinary.com/dente/image/upload/v1634436472/imagesStatic/Logo_Dente_Colores_cvutxk.png',
    companyName: templateData.companyName || 'Dente',
    supportEmail: templateData.supportEmail || 'soporte@denteapp.com',
    supportPhone: templateData.supportPhone || '+504 8893-0220',
    websiteUrl: templateData.websiteUrl || 'denteapp.com',
  };
  
  const daysRemaining = calculateDaysRemaining(suspension.clinicDetails.expiredSubsDate);
  
  const daysBetweenInvoices = suspension.firstInvoiceInfo && suspension.secondInvoiceInfo 
    ? calculateDaysBetween(suspension.firstInvoiceInfo.createdAt, suspension.secondInvoiceInfo.createdAt)
    : 0;

  // Crear un objeto con todos los valores que vamos a reemplazar
  const replacementValues = {
    // Información básica de la clínica
    adminName: suspension.adminNames?.[0] || 'Administrador',
    clinicName: suspension.clinicName || 'Clínica',
    clinicEmail: suspension.clinicEmail || 'No especificado',
    'clinic.adminNames[0]': suspension.adminNames?.[0] || 'Administrador',
    'clinic.clinicName': suspension.clinicName || 'Clínica',
    'clinic.clinicEmail': suspension.clinicEmail || 'No especificado',
    
    // Detalles de la clínica
    'clinic.clinicDetails.plan': getPlanName(suspension.clinicDetails.plan),
    'clinic.clinicDetails.licenceUser': suspension.clinicDetails.licenceUser.toString(),
    'clinic.clinicDetails.expiredSubsDate': formatDate(suspension.clinicDetails.expiredSubsDate),
    'clinic.clinicDetails.expiredSubsDateLong': formatDateLong(suspension.clinicDetails.expiredSubsDate),
    'clinic.clinicDetails.country': suspension.clinicDetails.country,
    'clinic.clinicDetails.avatar': suspension.clinicDetails.avatar || '',
    
    // Información de suspensión
    'clinic.unpaidCount': suspension.unpaidCount.toString(),
    'clinic.daysOverdue': suspension.daysOverdue.toString(),
    'clinic.shouldSuspend': suspension.shouldSuspend ? 'Sí' : 'No',
    unpaidCount: suspension.unpaidCount.toString(),
    daysOverdue: suspension.daysOverdue.toString(),
    shouldSuspend: suspension.shouldSuspend ? 'Sí' : 'No',
    
    // Estado del servicio
 
    
    // Información de la PRIMERA factura
    'clinic.firstInvoiceInfo.period': suspension.firstInvoiceInfo?.period || 'N/A',
    'clinic.firstInvoiceInfo.createdAt': formatDate(suspension.firstInvoiceInfo?.createdAt),
    'clinic.firstInvoiceInfo.createdAtLong': formatDateLong(suspension.firstInvoiceInfo?.createdAt),
    'clinic.firstInvoiceInfo.comment': suspension.firstInvoiceInfo?.comment || '',
    'clinic.firstInvoiceInfo.displayComment': suspension.firstInvoiceInfo?.displayComment || '',
    'firstInvoiceInfo.period': suspension.firstInvoiceInfo?.period || 'N/A',
    'firstInvoiceInfo.createdAt': formatDate(suspension.firstInvoiceInfo?.createdAt),
    'firstInvoiceInfo.createdAtLong': formatDateLong(suspension.firstInvoiceInfo?.createdAt),
    'firstInvoiceInfo.comment': suspension.firstInvoiceInfo?.comment || '',
    'firstInvoiceInfo.amount':  formatCurrency( suspension.firstInvoiceInfo.amount) || 0,
    'firstInvoiceInfo.displayComment': suspension.firstInvoiceInfo?.displayComment || '',
    
    // Información de la SEGUNDA factura
    'clinic.secondInvoiceInfo.period': suspension.secondInvoiceInfo?.period || 'N/A',
    'clinic.secondInvoiceInfo.createdAt': formatDate(suspension.secondInvoiceInfo?.createdAt),
    'clinic.secondInvoiceInfo.createdAtLong': formatDateLong(suspension.secondInvoiceInfo?.createdAt),
    'clinic.secondInvoiceInfo.comment': suspension.secondInvoiceInfo?.comment || '',
    'clinic.secondInvoiceInfo.displayComment': suspension.secondInvoiceInfo?.displayComment || '',
    'secondInvoiceInfo.period': suspension.secondInvoiceInfo?.period || 'N/A',
    'secondInvoiceInfo.createdAt': formatDate(suspension.secondInvoiceInfo?.createdAt),
    'secondInvoiceInfo.createdAtLong': formatDateLong(suspension.secondInvoiceInfo?.createdAt),
    'secondInvoiceInfo.comment': suspension.secondInvoiceInfo?.comment || '',
    'secondInvoiceInfo.amount':  formatCurrency( suspension.secondInvoiceInfo.amount) || 0,
    'secondInvoiceInfo.displayComment': suspension.secondInvoiceInfo?.displayComment || '',
    
    // Cálculos de tiempo
    daysBetweenInvoices: daysBetweenInvoices.toString(),
    
    // Fechas formateadas
    'date format="DD/MM/YYYY"': formatDate(new Date()),
    currentDate: formatDate(new Date()),
    currentDateLong: formatDateLong(new Date()),
    currentYear: new Date().getFullYear().toString(),
    
    // URLs y configuración
    paymentUrl: defaultUrls.paymentUrl,
    supportUrl: defaultUrls.supportUrl,
    logoUrl: defaultUrls.logoUrl,
    companyName: defaultUrls.companyName,
    supportEmail: defaultUrls.supportEmail,
    supportPhone: defaultUrls.supportPhone,
    websiteUrl: defaultUrls.websiteUrl,
    
    // Información adicional
    clinicId: suspension.clinicId.toString(),
    
    // Días restantes y estado
    daysRemainingText: daysRemaining.text,
    daysRemainingNumber: daysRemaining.days.toString(),
    isExpired: daysRemaining.isExpired ? 'Sí' : 'No',
    
    // Emails de administradores (en caso de que haya múltiples)
    adminEmails: suspension.adminEmails?.join(', ') || 'No especificado',
    adminNames: suspension.adminNames?.join(', ') || 'No especificado',
  };

  console.log('Replacement values:', replacementValues);

  // Aplicar todas las sustituciones
  let filledTemplate = mjmlTemplate;
  
  // Reemplazar cada valor
  Object.entries(replacementValues).forEach(([key, value]) => {
    // Crear regex para cada patrón posible
    const patterns = [
      new RegExp(`{{${key}}}`, 'g'),
      new RegExp(`{{\\s*${key}\\s*}}`, 'g'),
    ];
    
    patterns.forEach(pattern => {
      filledTemplate = filledTemplate.replace(pattern, String(value));
    });
  });
  
  // Reemplazar patrones especiales
  filledTemplate = filledTemplate.replace(/\((\d+) días restantes\)/g, `(${daysRemaining.text})`);
  
  // Reemplazar campos vacíos específicos del template
  // En tu template hay campos como {{}} que necesitan ser reemplazados
  filledTemplate = filledTemplate.replace(/{{}} factura\(s\) pendiente\(s\) con {{}} días/g, 
    `${suspension.unpaidCount} factura(s) pendiente(s) con ${suspension.daysOverdue} días`);
  
  // Reemplazar cualquier campo restante no mapeado
  filledTemplate = filledTemplate.replace(/{{[^}]+}}/g, (match) => {
    console.warn(`Campo no mapeado encontrado: ${match}`);
    return ''; // Reemplazar campos no mapeados con string vacío
  });

//   console.log('Template after replacements (first 500 chars):', filledTemplate.substring(0, 500));

  // Compilar MJML a HTML
  const { html, errors } = mjml2html(filledTemplate);

  if (errors.length > 0) {
    console.error('Errores al compilar MJML de suspensión:', errors);
    errors.forEach(error => {
      console.error(`- ${error.formattedMessage}`);
    });
  }

  return html;
}

// Función auxiliar para crear los datos de ejemplo
export function createSuspensionEmailData(suspensionData: SuspensionData): SuspensionTemplateData {
  return {
    suspension: suspensionData,
    paymentUrl: 'https://portal.denteapp.com/payment',
    supportUrl: 'https://denteapp.com/support',
    logoUrl: 'https://res.cloudinary.com/dente/image/upload/v1634436472/imagesStatic/Logo_Dente_Colores_cvutxk.png',
    companyName: 'Dente',
    supportEmail: 'soporte@denteapp.com',
    supportPhone: '+504 8893-0220',
    websiteUrl: 'denteapp.com',
  };
}