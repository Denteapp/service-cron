import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Appointment, AppointmentDocument } from 'src/schema/appointment.schema';
import { AppointmentResponseDto } from 'src/dto/appointment-response.dto';

@Injectable()
export class AppointmentsService {
    private readonly logger = new Logger(AppointmentsService.name);

    constructor(
        @InjectModel(Appointment.name)
        private readonly appointmentModel: Model<AppointmentDocument>,
    ) { }

    /**
     * Confirma una cita cambiando su estado a 'confirmed'
     */
    async confirmAppointment(id: string): Promise<AppointmentResponseDto> {
        try {
            // Validar que el ID sea válido
            if (!Types.ObjectId.isValid(id)) {
                throw new NotFoundException('ID de cita inválido');
            }

            const appointment = await this.appointmentModel.findByIdAndUpdate(
                id,
                { status: 'Confirmada' },
                { new: true },
            ).populate('patient', 'firstName lastName');

            if (!appointment) {
                throw new NotFoundException('Cita no encontrada');
            }

            // this.logger.log(`✅ Cita ${id} confirmada exitosamente`);

            const patient = appointment.patient as any;
            const patientName = patient?.firstName ? `${patient.firstName} ${patient.lastName || ''}`.trim() : 'Paciente';

            return {
                success: true,
                message: '✅ Tu cita ha sido confirmada exitosamente. Te esperamos en la fecha programada.',
                appointment: {
                    id: (appointment._id as Types.ObjectId).toString(),
                    status: appointment.status,
                    patientName: patientName,
                    appointmentDate: appointment.start,
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error confirmando cita ${id}:`, error.message);

            if (error instanceof NotFoundException) {
                throw error;
            }

            return {
                success: false,
                message: '❌ Error al confirmar la cita. Por favor, contacta con la clínica.',
            };
        }
    }

    /**
     * Cancela una cita cambiando su estado a 'cancelled'
     */
    async cancelAppointment(id: string): Promise<AppointmentResponseDto> {
        try {
            // Validar que el ID sea válido
            if (!Types.ObjectId.isValid(id)) {
                throw new NotFoundException('ID de cita inválido');
            }

            const appointment = await this.appointmentModel.findByIdAndUpdate(
                id,
                { status: 'Cancelada' },
                { new: true },
            ).populate('patient', 'firstName lastName');

            if (!appointment) {
                throw new NotFoundException('Cita no encontrada');
            }

            this.logger.log(`❌ Cita ${id} cancelada exitosamente`);

            const patient = appointment.patient as any;
            const patientName = patient?.firstName ? `${patient.firstName} ${patient.lastName || ''}`.trim() : 'Paciente';

            return {
                success: true,
                message: '❌ Tu cita ha sido cancelada. Si necesitas reagendar, por favor contacta con la clínica.',
                appointment: {
                    id: (appointment._id as Types.ObjectId).toString(),
                    status: appointment.status,
                    patientName: patientName,
                    appointmentDate: appointment.start,
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error cancelando cita ${id}:`, error.message);

            if (error instanceof NotFoundException) {
                throw error;
            }

            return {
                success: false,
                message: '❌ Error al cancelar la cita. Por favor, contacta con la clínica.',
            };
        }
    }

    /**
     * Obtiene información de una cita para reagendar
     */
    async getAppointmentForReschedule(id: string): Promise<AppointmentResponseDto> {
        try {
            // Validar que el ID sea válido
            if (!Types.ObjectId.isValid(id)) {
                throw new NotFoundException('ID de cita inválido');
            }

            const appointment = await this.appointmentModel.findById(id)
                .populate('patient', 'firstName lastName');

            if (!appointment) {
                throw new NotFoundException('Cita no encontrada');
            }

            // this.logger.log(`📅 Información de cita ${id} obtenida para reagendar`);

            const patient = appointment.patient as any;
            const patientName = patient?.firstName ? `${patient.firstName} ${patient.lastName || ''}`.trim() : 'Paciente';

            return {
                success: true,
                message: 'Para reagendar tu cita, por favor contacta con la clínica.',
                appointment: {
                    id: (appointment._id as Types.ObjectId).toString(),
                    status: appointment.status,
                    patientName: patientName,
                    appointmentDate: appointment.start,
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error obteniendo cita ${id}:`, error.message);

            if (error instanceof NotFoundException) {
                throw error;
            }

            return {
                success: false,
                message: '❌ Error al obtener la información de la cita. Por favor, contacta con la clínica.',
            };
        }
    }
}
