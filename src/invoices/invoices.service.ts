import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { addDays, addMonths, differenceInDays, format, startOfDay, subDays, subMonths } from 'date-fns';
import { MedicalClinic, MedicalClinicDocument, MedicalClinicWithAdmin } from '../schema/medicalClinic.schema';
import { canGenerateInvoiceCode, Payment, PaymentDocument, PaymentState, PaymentStateClinic } from '../schema/payment.schema';
import { NotificationService, SuspensionData } from '../notification/notification.service';
import { InvoiceValidationDto, InvoiceGenerationResultDto } from '../dto/invoice-validator.dto';



@Injectable()
export class InvoicesService {
    private readonly logger = new Logger(InvoicesService.name);

    constructor(
        @InjectModel(MedicalClinic.name)
        private medicalClinicModel: Model<MedicalClinicDocument>,
        @InjectModel(Payment.name)
        private paymentModel: Model<PaymentDocument>,
        private notificationService: NotificationService,
    ) { }

    // Obtener el período actual en formato MM/YY
    getCurrentPeriod = () => format(new Date(), 'MM/yy')
    // Buscar clínicas que necesitan facturación (5 días antes de expirar)
    async findClinicsToInvoice(): Promise<MedicalClinicDocument[]> {

        const currentDate = new Date();
        const fiveDaysFromNow = addDays(currentDate, 5);

        // Para obtener clínicas que expiran exactamente dentro de 5 días,
        // usamos startOfDay y endOfDay de date-fns para comparar solo la fecha
        const startOfFiveDaysFromNow = startOfDay(fiveDaysFromNow); // 00:00:00 del día 5
        const endOfFiveDaysFromNow = startOfDay(addDays(fiveDaysFromNow, 1)); // 00:00:00 del día 6

        return this.medicalClinicModel.aggregate([
            {
                $match: {
                    expiredSubsDate: {
                        $gte: startOfFiveDaysFromNow,  // Desde las 00:00 del día que es 5 días desde hoy
                        $lt: endOfFiveDaysFromNow      // Hasta las 00:00 del día siguiente
                    },
                    isActive: true,
                    paymentState: PaymentStateClinic.GRATIS, // Solo clínicas con estado de pago "Pago"
                }
            },
            {
                $lookup: {
                    from: 'users', // asegúrate de que esta es la colección real
                    let: { clinicId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$medicalClinic', '$$clinicId'] },
                                        { $eq: ['$role', 'admin'] }
                                    ]
                                }
                            }
                        },
                        {
                            $project: {
                                email: 1,
                                firstName: 1,
                                lastName: 1
                            }
                        }
                    ],
                    as: 'adminUsers'
                }
            },
            {
                $project: {
                    _id: 1,
                    medicalClinicName: 1,
                    country: 1,
                    plan: 1,
                    avatar: 1,
                    email: 1,
                    licenceUser: 1,
                    expiredSubsDate: 1,
                    adminEmails: {
                        $map: {
                            input: '$adminUsers',
                            as: 'admin',
                            in: '$$admin.email'
                        }
                    },
                    adminNames: {
                        $map: {
                            input: '$adminUsers',
                            as: 'admin',
                            in: { $concat: ['$$admin.firstName', ' ', '$$admin.lastName'] }
                        }
                    }
                }
            }
        ]);
    }

    // Contar facturas impagadas para una clínica
    async countUnpaidInvoices(clinicId: string): Promise<number> {

        return this.paymentModel.countDocuments({
            medicalClinic: new Types.ObjectId(clinicId),
            paymentState: PaymentState.GENERATED, // Generadas, no pagadas ya que si es Pending 0, es que ya genero la transacción, pero se buscan las que se han generado y no han sido pagadas
            // paymentState: { $in: [PaymentState.PENDING, PaymentState.GENERATED] }, // Si se quiere contar las pendientes y generadas
        });
    }

    // Verificar si ya se generó una factura para el período actual
    async hasInvoiceForCurrentPeriod(clinicId: string): Promise<boolean> {
        const currentPeriod = this.getCurrentPeriod();

        const existingInvoice = await this.paymentModel.findOne({
            medicalClinic: new Types.ObjectId(clinicId),
            period: currentPeriod,
        });

        return !!existingInvoice; // retorna true si existe factura para el período actual 
    }
    async canGenerateInvoice(clinicId: string): Promise<InvoiceValidationDto> {
        // Verificar si ya existe factura para el período actual
        const hasCurrentPeriodInvoice = await this.hasInvoiceForCurrentPeriod(clinicId);

        if (hasCurrentPeriodInvoice) {
            return {
                canGenerate: false,
                reason: 'Ya existe factura para el período actual',
                code: canGenerateInvoiceCode.PERIOD_EXISTS
            };
        }


        // Contar facturas impagadas
        const unpaidCount = await this.countUnpaidInvoices(clinicId);

        // Bloquear si hay 2 o más facturas impagadas
        if (unpaidCount > 1) { // Equivalente a >=2
            return {
                canGenerate: false,
                reason: 'Máximo de facturas impagadas alcanzado (2)',
                code: canGenerateInvoiceCode.MAX_UNPAID_REACHED,
                unpaidCount,
            };
        }

        return {
            canGenerate: true,
            unpaidCount,
            code: canGenerateInvoiceCode.CAN_GENERATE,
        };
    }

    // Inactivar clínica por facturas impagadas
    async deactivateClinicForNonPayment(clinicId: string, reason = 'Facturas impagadas'): Promise<MedicalClinicDocument | null> {

        const clinic = await this.medicalClinicModel.findByIdAndUpdate(
            clinicId,
            {
                isActive: false,
                paymentState: PaymentStateClinic.SUSPENDIDA, // Cambiar el estado de pago a SUSPENDIDA
            },
            { new: true },
        );

        if (clinic) {
            this.logger.warn(`🚫 Clínica ${clinic.medicalClinicName} desactivada por: ${reason}`);
            // Aquí podrías enviar una notificación de suspensión
            // await this.notificationService.sendSuspensionNotification(clinic.email, reason);
        } else {
            this.logger.warn(`🚫 No se encontró la clínica con ID ${clinicId} para desactivar por: ${reason}`);
        }

        return clinic;
    }

    // Generar ID único para transacciones
    private generateTransactionID(clinicId: string): string {

        const random = Math.random().toString(36).substr(2, 9);
        return `INIT-${clinicId}`;
    }

    // Generar referencia externa única
    private generateExternalReference(period: string, clinicId: string): string {
        const random = Math.random().toString(36).substr(2, 6).toUpperCase();
        return `INIT-${clinicId}-${random}`;
    }



    async generateInvoice(clinicData: MedicalClinicDocument): Promise<InvoiceGenerationResultDto> {

        const currentPeriod = this.getCurrentPeriod();

        // Verificar si ya existe factura para este período
        const existingInvoice = await this.paymentModel.findOne({
            medicalClinic: clinicData._id,
            period: currentPeriod,
        });

        if (existingInvoice) {
            throw new Error(`Ya existe una factura generada para el período ${currentPeriod}`);
        }

        // Validar si se puede generar la factura
        const validation = await this.canGenerateInvoice(clinicData._id.toString());
        if (!validation.canGenerate) {
            throw new Error(`No se puede generar factura: ${validation.reason}`);
        }

        // Determinar si es la segunda factura impagada
        const isSecondUnpaidInvoice = validation.unpaidCount === 1;

        // Crear la factura
        const initialPrice = 800;
        const additionalPricePerProfessional = 200;
        const licenceUser = clinicData.licenceUser ?? 1;
        const totalPrice = initialPrice + (licenceUser - 1) * additionalPricePerProfessional;

        const invoice = new this.paymentModel({
            medicalClinic: clinicData._id,
            amount: totalPrice,
            description: `Factura mensual - ${clinicData.medicalClinicName} (${currentPeriod})`,
            period: currentPeriod,
            user: '',
            paymentState: PaymentState.GENERATED,
            transactionID: this.generateTransactionID(clinicData._id.toString()),
            bankName: '',
            externalReference: this.generateExternalReference(currentPeriod, clinicData._id.toString()),
            holderName: clinicData.medicalClinicName,
            recipientImg: '',
            paymentMethod: 'Transferencia',
            last4Digits: '0000',
            paidAt: null,
            transferDate: new Date().toISOString(),
            isAutomatic: true,
            generatedBy: 'Automatico',
            issuedDate: new Date().toISOString(),
            billingCycle: 'Mensual',
            displayStatus: 'Factura emitida, pago en espera',
        });

        await invoice.save();

        // ACTUALIZA LA FECHA DE EXPIRACIÓN DE LA SUSCRIPCIÓN 1 mes mas
        const currentExpiredDate = clinicData.expiredSubsDate;
        const newExpiredSubsDate = addMonths(currentExpiredDate, 1);

        await this.medicalClinicModel.findByIdAndUpdate(
            clinicData._id,
            {
                expiredSubsDate: newExpiredSubsDate,
                // También podrías actualizar el paymentState si es necesario
                // paymentState: 'Pago' // o el estado que corresponda
            },
            { new: true }
        );

        this.logger.log(`✅ Factura generada para ${clinicData.medicalClinicName}`);
        this.logger.log(`📅 Nueva fecha de expiración para ${clinicData.medicalClinicName}: ${newExpiredSubsDate.toISOString()} `);

        // Alertas especiales
        if (isSecondUnpaidInvoice) {
            this.logger.warn(`⚠️  ALERTA: ${clinicData.medicalClinicName} tiene 2 facturas impagadas. Próxima acción: suspensión.`);
        }

        return {
            invoice: invoice.toObject(),
            isSecondUnpaidInvoice,
            unpaidCount: (validation.unpaidCount ?? 0) + 1,
        };
    }

    // Cron job principal - ejecutar diariamente a las 9:00 AM
    @Cron(CronExpression.EVERY_MINUTE)
    async processBillingCron(): Promise<void> {

        const startTime = new Date();

        this.logger.log(`🚀 Iniciando proceso de facturación - ${startTime.toISOString()}`);

        try {
            // 1. Buscar clínicas que necesiten facturación
            const clinicsToInvoice = await this.findClinicsToInvoice() as MedicalClinicDocument[];

            this.logger.log(`📋 Encontradas ${clinicsToInvoice.length}  clínicas para procesar`);

            if (clinicsToInvoice.length === 0) {
                this.logger.log('ℹ️  No hay clínicas para facturar en este momento');
                return;
            }

            let successCount = 0;
            let errorCount = 0;
            let skippedCount = 0;

            for (const clinic of clinicsToInvoice) {
                try {
                    this.logger.log(`--------------------------------------------------------------------------`);
                    this.logger.log(`Procesando: ${clinic.medicalClinicName}`);

                    // Verificar si ya tiene factura este mes
                    const currentPeriod = this.getCurrentPeriod();
                    const hasCurrentInvoice = await this.paymentModel.findOne({
                        medicalClinic: clinic._id,
                        period: currentPeriod,
                    });

                    // this.logger.log(`🔍 Tiene factura actual: ${hasCurrentInvoice}`);
                    // this.logger.log(`🔍 Verificando factura para ${clinic.medicalClinicName} - Período: ${currentPeriod}`);

                    if (hasCurrentInvoice) {
                        this.logger.log(`⏭️  ${clinic.medicalClinicName}: Ya tiene factura para ${currentPeriod}`);
                        skippedCount++;
                        continue;
                    }

                    // 2. Verificar si puede generar factura
                    const validation = await this.canGenerateInvoice(clinic._id.toString());

                    this.logger.log(`Validación para ${clinic.medicalClinicName}`);
                    if (validation.canGenerate) {
                        // Obtener el documento completo de la clínica desde la base de datos
                        const clinicDoc = await this.medicalClinicModel.findById(clinic._id);

                        if (!clinicDoc) {
                            this.logger.warn(`⚠️ No se encontró el documento de la clínica con ID ${clinic._id}`);
                            skippedCount++;
                            continue;
                        }

                        // 3. Generar factura
                        const result = await this.generateInvoice(clinicDoc);

                        // 4. Enviar notificación por email
                        try {
                            // Usar el email del admin si está disponible, si no, usar el de la clínica
                            const notificationEmail = clinic.adminEmails?.[0] || clinic.email || null;
                            if (notificationEmail) {
                                await this.notificationService.sendInvoiceNotification(
                                    notificationEmail,
                                    {
                                        invoice: result.invoice,
                                        clinic: clinic // Agregas el objeto clinic aquí
                                    }
                                );
                                this.logger.log(`📧 Notificación enviada a ${notificationEmail}`);
                            } else {
                                this.logger.warn(
                                    `⚠️ Clínica ${clinic.medicalClinicName} no tiene email registrado, no se envió notificación.`
                                );
                            }
                        } catch (emailError) {
                            this.logger.error(
                                `📧❌ Error enviando email:`,
                                emailError.message
                            );
                        }

                        successCount++;
                    } else {
                        this.logger.log(`⏭️  ${clinic.medicalClinicName}: ${validation.reason}`);
                        skippedCount++;
                    }

                    // Si tiene 2 facturas impagadas, considerar suspensión
                    if (validation.code === 'MAX_UNPAID_REACHED') {
                        this.logger.log(`⚠️ Evaluando suspensión para ${clinic.medicalClinicName}...`);
                        // Aquí podrías agregar lógica adicional para suspender después de X días
                    }

                } catch (error) {
                    this.logger.error(`❌ Error procesando ${clinic.medicalClinicName}:`, error.message);
                    errorCount++;
                }
            }

            // Resumen del proceso
            const endTime = new Date();
            const duration = endTime.getTime() - startTime.getTime();

            this.logger.log(`\n📊 RESUMEN DEL PROCESO:`);
            this.logger.log(`   ✅ Exitosas: ${successCount}`);
            this.logger.log(`   ⏭️ Omitidas: ${skippedCount}`);
            this.logger.log(`   ❌ Errores: ${errorCount}`);
            this.logger.log(`   ⏱️ Duración: ${duration}ms`);
            this.logger.log(`   🏁 Finalizado: ${endTime.toISOString()} \n`);
        } catch (error) {
            this.logger.error('💥 Error crítico en el proceso de facturación:', error);
        }
    }

    // Cron job de desarrollo - cada 10 segundos (comentar en producción)
    // @Cron(CronExpression.EVERY_MINUTE)

    async processBillingCronDev(): Promise<void> {
        this.logger.debug('🧪 [DESARROLLO] Ejecutando cron job de prueba...');
        await this.processBillingCron();
    }


    // @Cron(CronExpression.EVERY_DAY_AT_8AM)

    async checkOverdueInvoices(): Promise<void> {
        this.logger.log('🔍 Iniciando evaluación de facturas impagas...');

        const gracePeriodDays = 5; // Días de gracia después de la segunda factura
        const overdueDate = subDays(new Date(), gracePeriodDays);

        try {
            // Consulta única que obtiene clínicas con facturas impagas, información de la clínica y usuarios admin
            const clinicsWithUnpaidAndUsers = await this.paymentModel.aggregate([
                {
                    $match: {
                        paymentState: PaymentState.GENERATED,
                    }
                },
                {
                    $sort: { createdAt: 1 } // Orden cronológico
                },
                {
                    $group: {
                        _id: '$medicalClinic',
                        unpaidInvoices: { $push: '$$ROOT' },
                        count: { $sum: 1 }
                    }
                },
                {
                    $match: {
                        count: { $gte: 2 }
                    }
                },
                {
                    // Lookup para obtener información de la clínica
                    $lookup: {
                        from: 'medicalclinics',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'clinicInfo'
                    }
                },
                {
                    $unwind: '$clinicInfo'
                },
                {
                    // Filtrar solo clínicas activas
                    $match: {
                        'clinicInfo.isActive': true
                    }
                },
                {
                    // Lookup para obtener usuarios admin
                    $lookup: {
                        from: 'users',
                        let: { clinicId: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ['$medicalClinic', '$$clinicId'] },
                                            { $eq: ['$role', 'admin'] }
                                        ]
                                    }
                                }
                            },
                            {
                                $project: {
                                    email: 1,
                                    firstName: 1,
                                    lastName: 1
                                }
                            }
                        ],
                        as: 'adminUsers'
                    }
                },
                {
                    $project: {
                        _id: 1,
                        unpaidInvoices: 1,
                        count: 1,
                        // Información de la clínica
                        clinicName: '$clinicInfo.medicalClinicName',
                        clinicEmail: '$clinicInfo.email',
                        country: '$clinicInfo.country',
                        plan: '$clinicInfo.plan',
                        avatar: '$clinicInfo.avatar',
                        licenceUser: '$clinicInfo.licenceUser',
                        expiredSubsDate: '$clinicInfo.expiredSubsDate',
                        // Información de usuarios admin
                        adminEmails: {
                            $map: {
                                input: '$adminUsers',
                                as: 'admin',
                                in: '$$admin.email'
                            }
                        },
                        adminNames: {
                            $map: {
                                input: '$adminUsers',
                                as: 'admin',
                                in: { $concat: ['$$admin.firstName', ' ', '$$admin.lastName'] }
                            }
                        },
                    }
                }
            ]);

            // Definir tipo para la clínica procesada
            interface ProcessedClinic {
                clinicId: any;
                clinicName: string;
                clinicEmail: string;
                adminEmails: string[];
                adminNames: string[];
                shouldSuspend: boolean;
                daysOverdue: number;
                firstInvoiceInfo: {
                    createdAt: Date;
                    period: string;
                    comment: string;
                    amount: number;
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
                    plan: string;
                    avatar: string;
                    licenceUser: number;
                    expiredSubsDate: Date;
                };
            }


            // Procesar clínicas para determinar cuáles deben ser suspendidas
            const clinicsToNotifyOrSuspend: ProcessedClinic[] = clinicsWithUnpaidAndUsers
                .map(group => {
                    const clinicId = group._id;
                    const invoices = group.unpaidInvoices;

                    if (invoices.length < 2) return null; // Saltar si no hay al menos dos facturas

                    const firstInvoice = invoices[0];
                    const secondInvoice = invoices[1];
                    const secondInvoiceDate = new Date(secondInvoice.createdAt);
                    const shouldSuspend = secondInvoiceDate < overdueDate;

                    const daysOverdue = differenceInDays(new Date(), secondInvoiceDate);
                    console.log(shouldSuspend);
                    console.log(daysOverdue);

                    return {
                        clinicId,
                        clinicName: group.clinicName,
                        clinicEmail: group.clinicEmail,
                        adminEmails: group.adminEmails || [],
                        adminNames: group.adminNames || [],
                        shouldSuspend,
                        daysOverdue,
                        firstInvoiceInfo: {
                            createdAt: firstInvoice.createdAt,
                            period: firstInvoice.period,
                            comment: firstInvoice.comment,
                            amount: firstInvoice.amount,
                            displayComment: firstInvoice.displayStatus,
                        },
                        secondInvoiceInfo: {
                            createdAt: secondInvoice.createdAt,
                            period: secondInvoice.period,
                            amount: secondInvoice.amount,
                            comment: secondInvoice.comment,
                            displayComment: secondInvoice.displayStatus,
                        },
                        unpaidCount: invoices.length,
                        clinicDetails: {
                            country: group.country,
                            plan: group.plan,
                            avatar: group.avatar,
                            licenceUser: group.licenceUser,
                            expiredSubsDate: group.expiredSubsDate,
                        },
                    } as ProcessedClinic;
                })
                .filter((clinic): clinic is ProcessedClinic => clinic !== null && clinic.shouldSuspend); // Solo clínicas que deben ser suspendidas

            this.logger.log(`📊 Clínicas encontradas para suspensión: ${clinicsToNotifyOrSuspend.length}`);

            // Procesar cada clínica que debe ser suspendida
            for (const clinic of clinicsToNotifyOrSuspend) {
                const actionMsg = `📋 Clínica: ${clinic.clinicName}, Facturas impagas: ${clinic.unpaidCount}, Días vencido: ${clinic.daysOverdue}, Admins: ${clinic.adminNames.join(', ')}`;

                this.logger.log(`🔄 Procesando: ${actionMsg}`);

                try {
                    // Desactivar la clínica
                    await this.deactivateClinicForNonPayment(
                        clinic.clinicId,
                        `🚫 Superó los ${gracePeriodDays} días tras segunda factura. Días vencido: ${clinic.daysOverdue}`
                    );

                    // Preparar emails para notificación
                    const emailsToNotify = [...new Set(clinic.adminEmails)]; // Eliminar duplicados

                    // console.log(emailsToNotify);


                    if (emailsToNotify.length > 0) {
                        // Enviar notificación de suspensión
                        await this.notificationService.sendSuspensionNotification(emailsToNotify, clinic as any);

                        this.logger.log(`✅ Suspendida y notificada: ${actionMsg}\n`);
                    } else {
                        this.logger.warn(`⚠️ No se encontraron emails de admin para notificar: ${clinic.clinicName}`);
                    }

                } catch (err) {
                    this.logger.error(`❌ Error procesando ${clinic.clinicName}:`, err.message);
                    // Continuar con la siguiente clínica en caso de error
                    continue;
                }
            }

            this.logger.log(`🏁 Evaluación completa. Clínicas procesadas: ${clinicsToNotifyOrSuspend.length}`);

        } catch (error) {
            this.logger.error('💥 Error al evaluar facturas impagas:', error);
            throw error; // Re-lanzar el error para que pueda ser manejado por el caller
        }
    }


}