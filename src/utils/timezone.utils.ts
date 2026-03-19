/**
 * Utilidades para manejo de zonas horarias
 * Diseñado para soportar múltiples timezones de forma parametrizada
 */
export class TimezoneUtils {
  static readonly DEFAULT_TIMEZONE = 'America/Tegucigalpa';

  /**
   * Formatea fecha a hora local de una zona horaria específica
   * @param date - Fecha a formatear
   * @param timezone - Zona horaria en formato IANA (ej: 'America/Tegucigalpa')
   * @returns String formateado con fecha y hora
   */
  static formatToTimezone(
    date: Date,
    timezone: string = TimezoneUtils.DEFAULT_TIMEZONE,
  ): string {
    return new Intl.DateTimeFormat('es-HN', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  }

  /**
   * Obtiene la hora actual en una zona horaria específica (0-23)
   * @param timezone - Zona horaria en formato IANA
   * @returns Hora en formato 24h (0-23)
   */
  static getCurrentHourInTimezone(
    timezone: string = TimezoneUtils.DEFAULT_TIMEZONE,
  ): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    return parseInt(formatter.format(new Date()));
  }

  /**
   * Obtiene la hora de una fecha específica en una zona horaria (0-23)
   * @param date - Fecha a evaluar
   * @param timezone - Zona horaria en formato IANA
   * @returns Hora en formato 24h (0-23)
   */
  static getHourInTimezone(
    date: Date,
    timezone: string = TimezoneUtils.DEFAULT_TIMEZONE,
  ): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    return parseInt(formatter.format(date));
  }

  /**
   * Verifica si es horario laboral (8 AM - 8 PM por defecto) en una timezone
   * @param timezone - Zona horaria en formato IANA
   * @param startHour - Hora de inicio (default: 8)
   * @param endHour - Hora de fin (default: 20)
   * @returns true si está dentro del horario laboral
   */
  static isBusinessHours(
    timezone: string = TimezoneUtils.DEFAULT_TIMEZONE,
    startHour: number = 8,
    endHour: number = 20,
  ): boolean {
    const currentHour = TimezoneUtils.getCurrentHourInTimezone(timezone);
    return currentHour >= startHour && currentHour <= endHour;
  }

  /**
   * Verifica si un mensaje enviado X horas antes de una cita llegaría en horario laboral (7 AM - 8 PM)
   * @param appointmentDate - Fecha/hora de la cita
   * @param hoursBeforeNotification - Cuántas horas antes se enviaría el mensaje (ej: 24, 4, 2)
   * @param timezone - Zona horaria de la clínica
   * @param minHour - Hora mínima permitida para envío (default: 7 AM)
   * @param maxHour - Hora máxima permitida para envío (default: 8 PM)
   * @returns true si el mensaje se enviaría entre 7 AM - 8 PM, false si sería fuera de horario
   */
  static willBeDeliveredInBusinessHours(
    appointmentDate: Date,
    hoursBeforeNotification: number,
    timezone: string = TimezoneUtils.DEFAULT_TIMEZONE,
    minHour: number = 7,
    maxHour: number = 20,
  ): boolean {
    // Calcular cuándo se enviaría el mensaje
    const deliveryTime = new Date(appointmentDate.getTime() - (hoursBeforeNotification * 60 * 60 * 1000));
    
    // Obtener la hora en la que llegaría el mensaje según el timezone de la clínica
    const deliveryHour = TimezoneUtils.getHourInTimezone(deliveryTime, timezone);
    
    // Verificar si está dentro del horario permitido (7 AM - 8 PM)
    return deliveryHour >= minHour && deliveryHour <= maxHour;
  }

  /**
   * Formatea fecha/hora de una cita para mostrar al usuario
   * @param appointmentStart - Fecha UTC de la cita
   * @param timezone - Zona horaria en formato IANA
   * @returns Objeto con fecha y hora formateadas por separado
   */
  static formatAppointmentDateTime(
    appointmentStart: Date,
    timezone: string = TimezoneUtils.DEFAULT_TIMEZONE,
  ): { date: string; time: string } {
    const dateStr = new Intl.DateTimeFormat('es', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(appointmentStart);

    const timeStr = new Intl.DateTimeFormat('es', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(appointmentStart);

    return { date: dateStr, time: timeStr };
  }

  /**
   * Formatea fecha/hora de una cita para WhatsApp de manera amigable
   * Detecta si es "mañana" y usa formato de 12h con AM/PM
   * @param appointmentStart - Fecha UTC de la cita
   * @param timezone - Zona horaria en formato IANA
   * @returns Objeto con fecha y hora formateadas para WhatsApp
   */
  static formatAppointmentForWhatsApp(
    appointmentStart: Date,
    timezone: string = TimezoneUtils.DEFAULT_TIMEZONE,
  ): { date: string; time: string } {
    const now = new Date();
    
    // Calcular diferencia en días
    const appointmentDay = new Date(appointmentStart).setHours(0, 0, 0, 0);
    const today = new Date(now).setHours(0, 0, 0, 0);
    const diffDays = Math.floor((appointmentDay - today) / (1000 * 60 * 60 * 24));

    let dateStr: string;

    if (diffDays === 1) {
      // Es mañana - mostrar "Mañana [Día] [#] de [mes corto] [año]"
      const weekdayFormatter = new Intl.DateTimeFormat('es', {
        timeZone: timezone,
        weekday: 'long',
      });
      const dateFormatter = new Intl.DateTimeFormat('es', {
        timeZone: timezone,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      const weekday = weekdayFormatter.format(appointmentStart);
      const formattedDate = dateFormatter.format(appointmentStart);
      // Capitalizar primera letra del día de la semana
      const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
      dateStr = `Mañana ${capitalizedWeekday} ${formattedDate}`;
    } else if (diffDays === 0) {
      // Es hoy - formato similar
      const weekdayFormatter = new Intl.DateTimeFormat('es', {
        timeZone: timezone,
        weekday: 'long',
      });
      const dateFormatter = new Intl.DateTimeFormat('es', {
        timeZone: timezone,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      const weekday = weekdayFormatter.format(appointmentStart);
      const formattedDate = dateFormatter.format(appointmentStart);
      const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
      dateStr = `Hoy ${capitalizedWeekday} ${formattedDate}`;
    } else {
      // Otro día - mostrar día de semana + fecha
      const weekdayFormatter = new Intl.DateTimeFormat('es', {
        timeZone: timezone,
        weekday: 'long',
      });
      const dateFormatter = new Intl.DateTimeFormat('es', {
        timeZone: timezone,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      const weekday = weekdayFormatter.format(appointmentStart);
      const formattedDate = dateFormatter.format(appointmentStart);
      const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
      dateStr = `${capitalizedWeekday} ${formattedDate}`;
    }

    // Hora en formato 24h (HH:MM)
    const timeStr = new Intl.DateTimeFormat('es', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(appointmentStart);

    return { date: dateStr, time: timeStr };
  }

  /**
   * Obtiene lista de timezones comunes para testing
   * @returns Array de timezones con sus nombres
   */
  static getCommonTimezones(): { name: string; timezone: string }[] {
    return [
      { name: 'Honduras', timezone: 'America/Tegucigalpa' },
      { name: 'México (CDMX)', timezone: 'America/Mexico_City' },
      { name: 'USA (Este)', timezone: 'America/New_York' },
      { name: 'USA (Pacífico)', timezone: 'America/Los_Angeles' },
      { name: 'España', timezone: 'Europe/Madrid' },
      { name: 'Argentina', timezone: 'America/Argentina/Buenos_Aires' },
      { name: 'Colombia', timezone: 'America/Bogota' },
      { name: 'Chile', timezone: 'America/Santiago' },
    ];
  }
}
