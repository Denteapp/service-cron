import { Controller, Get, Param, Res, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AppointmentsService } from './appointments.service';

@Controller('appointments')
export class AppointmentsController {
    private readonly logger = new Logger(AppointmentsController.name);

    constructor(private readonly appointmentsService: AppointmentsService) { }

    /**
     * Endpoint para confirmar una cita
     * GET /appointments/confirm/:id
     */
    @Get('confirm/:id')
    async confirmAppointment(
        @Param('id') id: string,
        @Res() res: Response,
    ) {
        try {
            this.logger.log(`📋 Intento de confirmar cita: ${id}`);
            
            const result = await this.appointmentsService.confirmAppointment(id);

            if (result.success) {
                this.logger.log(`✅ Cita confirmada exitosamente: ${id}`);
            } else {
                this.logger.warn(`⚠️ No se pudo confirmar la cita: ${id} - ${result.message}`);
            }

            const html = this.generateResponseHtml(
                result.success,
                result.message,
                result.appointment,
                'Cita Confirmada',
            );

            return res.status(result.success ? HttpStatus.OK : HttpStatus.BAD_REQUEST).send(html);
        } catch (error) {
            this.logger.error(`❌ Error al confirmar cita ${id}: ${error.message}`, error.stack);
            
            const html = this.generateResponseHtml(
                false,
                'Ocurrió un error inesperado. Por favor contactá a soporte.',
                null,
                'Error',
            );

            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(html);
        }
    }

    /**
     * Endpoint para cancelar una cita
     * GET /appointments/cancel/:id
     */
    @Get('cancel/:id')
    async cancelAppointment(
        @Param('id') id: string,
        @Res() res: Response,
    ) {
        try {
            // this.logger.log(`📋 Intento de cancelar cita: ${id}`);
            
            const result = await this.appointmentsService.cancelAppointment(id);

            if (result.success) {
                this.logger.log(`✅ Cita cancelada exitosamente: ${id}`);
            } else {
                this.logger.warn(`⚠️ No se pudo cancelar la cita: ${id} - ${result.message}`);
            }

            const html = this.generateResponseHtml(
                result.success,
                result.message,
                result.appointment,
                'Cita Cancelada',
            );

            return res.status(result.success ? HttpStatus.OK : HttpStatus.BAD_REQUEST).send(html);
        } catch (error) {
            this.logger.error(`❌ Error al cancelar cita ${id}: ${error.message}`, error.stack);
            
            const html = this.generateResponseHtml(
                false,
                'Ocurrió un error inesperado. Por favor contactá a soporte.',
                null,
                'Error',
            );

            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(html);
        }
    }

    /**
     * Endpoint para obtener información de reagendamiento
     * GET /appointments/reschedule/:id
     */
    @Get('reschedule/:id')
    async rescheduleAppointment(
        @Param('id') id: string,
        @Res() res: Response,
    ) {
        try {
            // this.logger.log(`📋 Intento de reagendar cita: ${id}`);
            
            const result = await this.appointmentsService.getAppointmentForReschedule(id);

            if (result.success) {
                this.logger.log(`✅ Información de cita obtenida para reagendar: ${id}`);
            } else {
                this.logger.warn(`⚠️ No se pudo obtener info de cita: ${id} - ${result.message}`);
            }

            const html = this.generateResponseHtml(
                result.success,
                result.message,
                result.appointment,
                'Reagendar Cita',
            );

            return res.status(result.success ? HttpStatus.OK : HttpStatus.BAD_REQUEST).send(html);
        } catch (error) {
            this.logger.error(`❌ Error al obtener info para reagendar ${id}: ${error.message}`, error.stack);
            
            const html = this.generateResponseHtml(
                false,
                'Ocurrió un error inesperado. Por favor contactá a soporte.',
                null,
                'Error',
            );

            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(html);
        }
    }

    /**
     * Genera una página HTML amigable para mostrar el resultado
     */
    private generateResponseHtml(
        success: boolean,
        message: string,
        appointment: any,
        title: string,
    ): string {
        const icon = success ? '✅' : '❌';
        const color = success ? '#10b981' : '#ef4444';

        return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title} </title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #0077ff 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            text-align: center;
          }
          .icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          h1 {
            color: #1f2937;
            font-size: 28px;
            margin-bottom: 16px;
          }
          .message {
            color: #6b7280;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 24px;
          }
          .appointment-info {
            background: #f9fafb;
            border-radius: 12px;
            padding: 20px;
            margin-top: 24px;
            text-align: left;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #e5e7eb;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            font-weight: 600;
            color: #4b5563;
          }
          .info-value {
            color: #1f2937;
          }
          .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            background: ${color};
            color: white;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">${icon}</div>
          <h1>${title}</h1>
          <p class="message">${message}</p>
          ${appointment ? `
            <div class="appointment-info">
              <div class="info-row">
                <span class="info-label">Paciente:</span>
                <span class="info-value">${appointment.patientName}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Fecha:</span>
                <span class="info-value">${new Date(appointment.appointmentDate).toLocaleString('es-ES')}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Estado:</span>
                <span class="status-badge">${appointment.status}</span>
              </div>
            </div>
          ` : ''}
        </div>
      </body>
      </html>
    `;
    }
}
