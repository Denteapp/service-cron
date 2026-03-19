export class AppointmentResponseDto {
    success: boolean;
    message: string;
    appointment?: {
        id: string;
        status: string;
        patientName: string;
        appointmentDate: Date;
    };
}
