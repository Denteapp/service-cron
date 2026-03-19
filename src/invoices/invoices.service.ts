import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { addDays, addMonths, differenceInDays, format, startOfDay, subDays, subMonths } from 'date-fns';
import { MedicalClinic, MedicalClinicDocument, MedicalClinicWithAdmin } from '../schema/medicalClinic.schema';
import { Subscription, SubscriptionDocument } from '../schema/subscription.schema';
import { canGenerateInvoiceCode, Payment, PaymentDocument, PaymentState, PaymentStateClinic } from '../schema/payment.schema';
import { NotificationService, SuspensionData } from '../notification/notification.service';
import { InvoiceValidationDto, InvoiceGenerationResultDto } from '../dto/invoice-validator.dto';

// Clínicas de prueba para desarrollo local - MANTENER SIEMPRE
const TEST_CLINIC_ID = [
    '6613754dbb593f4d49c218a4', // Clínica de prueba 1
    '66140c1b058ec6710b7f4f7f', // Clínica de prueba 2
];

// Interfaz para datos de facturación desde el aggregate
export interface SubscriptionBillingData {
    _id: Types.ObjectId; // Subscription ID
    medicalClinic: Types.ObjectId; // Clinic ID
    medicalClinicName: string;
    country: string;
    currency: string;
    planName: string;
    planPrice: number;
    additionalUserPrice: number;
    billingFrequency: string;
    nextBillingDate: Date;
    endDate: Date;
    usersCount: number;
    rootEmail: string;
    rootName: string;
    clinicIsActive: boolean;
}



@Injectable()
export class InvoicesService {
    private readonly logger = new Logger(InvoicesService.name);

    constructor(
        @InjectModel(MedicalClinic.name)
        private medicalClinicModel: Model<MedicalClinicDocument>,
        @InjectModel(Subscription.name)
        private subscriptionModel: Model<SubscriptionDocument>,
        @InjectModel(Payment.name)
        private paymentModel: Model<PaymentDocument>,
        private notificationService: NotificationService,
    ) { }

    // Obtener el período actual en formato MM/YY
    getCurrentPeriod = () => format(new Date(), 'MM/yy')
    
    // Buscar suscripciones que necesitan facturación (endDate = hoy)
    async findClinicsToInvoice(): Promise<SubscriptionBillingData[]> {
        const currentDate = new Date();
    
        // Para obtener clínicas que expiran exactamente HOY,
        // usamos startOfDay y endOfDay para comparar solo la fecha actual
        const startOfToday = startOfDay(currentDate); // 00:00:00 de hoy
        const endOfToday = startOfDay(addDays(currentDate, 1)); // 00:00:00 de mañana

        this.logger.log(`🔍 Buscando suscripciones con endDate = HOY (${startOfToday.toISOString().split('T')[0]})`);

        return this.subscriptionModel.aggregate([
            {
                // Filtrar solo suscripciones mensuales activas con endDate = hoy
                $match: {
                    endDate: {
                        $gte: startOfToday,  // Desde las 00:00 de hoy
                        $lt: endOfToday      // Hasta las 00:00 de mañana
                    },
                    billingFrequency: 'Mensual',
                    isActive: true,
                }
            },
            {
                // Lookup para obtener información de la clínica (solo para verificar existencia)
                $lookup: {
                    from: 'medicalclinics',
                    localField: 'medicalClinic',
                    foreignField: '_id',
                    as: 'clinicInfo'
                }
            },
            {
                // Desempaquetar el array de clínica
                $unwind: {
                    path: '$clinicInfo',
                    preserveNullAndEmptyArrays: false // Solo mantener suscripciones con clínica válida
                }
            },
            {
                // Lookup para obtener el usuario root (propietario de la clínica)
                $lookup: {
                    from: 'users',
                    let: { clinicId: '$medicalClinic' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$medicalClinic', '$$clinicId'] },
                                        { $eq: ['$role', 'root'] }
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
                    as: 'rootUsers'
                }
            },
            {
                // Desempaquetar el usuario root (debe haber solo uno)
                $unwind: {
                    path: '$rootUsers',
                    preserveNullAndEmptyArrays: false // Solo procesar suscripciones con usuario root
                }
            },
            {
                $project: {
                    _id: 1, // Subscription ID
                    medicalClinic: 1, // Clinic ID
                    medicalClinicName: 1,
                    country: 1,
                    currency: 1,
                    planName: 1,
                    planPrice: 1,
                    additionalUserPrice: 1,
                    billingFrequency: 1,
                    nextBillingDate: 1,
                    endDate: 1,
                    usersCount: '$currentUsage.usersCount',
                    // Información del usuario root
                    rootEmail: '$rootUsers.email',
                    rootName: { $concat: ['$rootUsers.firstName', ' ', '$rootUsers.lastName'] },
                    // Info de la clínica (solo de referencia, no para filtrado)
                    clinicIsActive: '$clinicInfo.isActive',
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

    async generateInvoice(subscriptionData: SubscriptionBillingData): Promise<InvoiceGenerationResultDto> {
        const currentPeriod = this.getCurrentPeriod();
        const clinicId = subscriptionData.medicalClinic.toString();

        // Verificar si ya existe factura para este período
        const existingInvoice = await this.paymentModel.findOne({
            medicalClinic: subscriptionData.medicalClinic,
            period: currentPeriod,
        });

        if (existingInvoice) {
            throw new Error(`Ya existe una factura generada para el período ${currentPeriod}`);
        }

        // Validar si se puede generar la factura
        const validation = await this.canGenerateInvoice(clinicId);
        if (!validation.canGenerate) {
            throw new Error(`No se puede generar factura: ${validation.reason}`);
        }

        // Determinar si es la segunda factura impagada
        const isSecondUnpaidInvoice = validation.unpaidCount === 1;

        // Calcular precio total usando datos de la suscripción
        const usersCount = subscriptionData.usersCount ?? 1;
        const totalPrice = subscriptionData.planPrice + ((usersCount - 1) * subscriptionData.additionalUserPrice);

        // Crear la factura
        const invoice = new this.paymentModel({
            medicalClinic: subscriptionData.medicalClinic,
            amount: totalPrice,
            description: `Factura mensual - ${subscriptionData.medicalClinicName} (${currentPeriod})`,
            period: currentPeriod,
            currency: subscriptionData.currency || 'HNL',
            user: '',
            paymentState: PaymentState.GENERATED,
            transactionID: this.generateTransactionID(clinicId),
            bankName: '',
            externalReference: this.generateExternalReference(currentPeriod, clinicId),
            holderName: subscriptionData.medicalClinicName,
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

        try {
            await invoice.save();
        } catch (error) {
            // Si es un error de duplicado (código 11000 de MongoDB), significa que ya existe
            if (error.code === 11000) {
                throw new Error(`Ya existe una factura para ${subscriptionData.medicalClinicName} en el período ${currentPeriod}`);
            }
            throw error; // Re-lanzar otros errores
        }

        // ACTUALIZAR FECHAS: Extender suscripción por 1 mes
        const currentEndDate = new Date(subscriptionData.endDate);
        const newEndDate = addMonths(currentEndDate, 1);

        // Actualizar fechas en Subscription
        const updatedSubscription = await this.subscriptionModel.findByIdAndUpdate(
            subscriptionData._id,
            {
                endDate: newEndDate,
                nextBillingDate: newEndDate,
            },
            { new: true }
        );

        if (!updatedSubscription) {
            this.logger.warn(`⚠️ No se pudo actualizar la suscripción ${subscriptionData._id}`);
        } else {
            this.logger.log(`📅 Fechas actualizadas: próxima facturación ${newEndDate.toISOString().split('T')[0]}`);
        }

        // Actualizar también MedicalClinic.expiredSubsDate (sincronización legacy)
        await this.medicalClinicModel.findByIdAndUpdate(
            subscriptionData.medicalClinic,
            { expiredSubsDate: newEndDate },
            { new: true }
        );

        this.logger.log(`✅ Factura generada para ${subscriptionData.medicalClinicName} - Monto: $${totalPrice} ${subscriptionData.currency || 'HNL'}`);

        // Alertas especiales
        if (isSecondUnpaidInvoice) {
            this.logger.warn(`⚠️ ALERTA: ${subscriptionData.medicalClinicName} tiene 2 facturas impagadas. Próxima acción: suspensión.`);
        }

        return {
            invoice: invoice.toObject(),
            isSecondUnpaidInvoice,
            unpaidCount: (validation.unpaidCount ?? 0) + 1,
        };
    }

    // 🔄 CRON ACTIVO: Ejecutar una vez al día a las 8:15 AM
    @Cron('15 8 * * *')
    async processBillingCron(): Promise<void> {
        const startTime = new Date();

        this.logger.log(`🚀 [CRON FACTURAS] Iniciando proceso de facturación - ${startTime.toISOString()}`);

        try {
            // 1. Buscar suscripciones que necesiten facturación (ahora basado en Subscription)
            const subscriptionsToInvoice = await this.findClinicsToInvoice();

            this.logger.log(`📋 Encontradas ${subscriptionsToInvoice.length} suscripciones para procesar`);

            if (subscriptionsToInvoice.length === 0) {
                const endTime = new Date();
                const duration = endTime.getTime() - startTime.getTime();
                this.logger.log(`ℹ️  [CRON FACTURAS] Finalizado - No hay clínicas para facturar | Duración: ${duration}ms`);
                return;
            }

            let successCount = 0;
            let errorCount = 0;
            let skippedCount = 0;

            for (const subscription of subscriptionsToInvoice) {
                try {
                    this.logger.log(`--------------------------------------------------------------------------`);
                    this.logger.log(`Procesando: ${subscription.medicalClinicName}`);

                    // Verificar si ya tiene factura este mes
                    const currentPeriod = this.getCurrentPeriod();
                    const hasCurrentInvoice = await this.paymentModel.findOne({
                        medicalClinic: subscription.medicalClinic,
                        period: currentPeriod,
                    });

                    if (hasCurrentInvoice) {
                        this.logger.log(`⏭️  ${subscription.medicalClinicName}: Ya tiene factura para ${currentPeriod}`);
                        skippedCount++;
                        continue;
                    }

                    // 2. Verificar si puede generar factura
                    const validation = await this.canGenerateInvoice(subscription.medicalClinic.toString());

                    this.logger.log(`Validación para ${subscription.medicalClinicName}`);
                    if (validation.canGenerate) {
                        // 3. Generar factura (ahora con subscriptionData directamente)
                        const result = await this.generateInvoice(subscription);

                        // 4. Enviar notificación por email
                        try {
                            // Usar el email del usuario root
                            const notificationEmail = subscription.rootEmail;
                            if (notificationEmail) {
                                // Calcular desglose de facturación
                                const usersCount = subscription.usersCount ?? 1;
                                const additionalUsers = Math.max(0, usersCount - 1);
                                const additionalUsersTotal = additionalUsers * subscription.additionalUserPrice;
                                
                                // LOG TEMPORAL PARA DEBUG
                                this.logger.log(`📊 Desglose de facturación para ${subscription.medicalClinicName}:`);
                                this.logger.log(`   - Plan: ${subscription.planName}`);
                                this.logger.log(`   - Precio base: ${subscription.planPrice}`);
                                this.logger.log(`   - Total usuarios: ${usersCount}`);
                                this.logger.log(`   - Usuarios adicionales: ${additionalUsers}`);
                                this.logger.log(`   - Precio por usuario adicional: ${subscription.additionalUserPrice}`);
                                this.logger.log(`   - Total usuarios adicionales: ${additionalUsersTotal}`);
                                this.logger.log(`   - Total factura: ${result.invoice.amount}`);
                                
                                await this.notificationService.sendInvoiceNotification(
                                    notificationEmail,
                                    {
                                        invoice: result.invoice,
                                        clinic: {
                                            medicalClinicName: subscription.medicalClinicName,
                                            email: subscription.rootEmail,
                                            _id: subscription.medicalClinic.toString(),
                                            adminNames: [subscription.rootName],
                                            adminEmails: [subscription.rootEmail],
                                            expiredSubsDate: subscription.endDate.toISOString(),
                                            plan: subscription.planName,
                                            licenceUser: usersCount,
                                            avatar: '',
                                            country: subscription.country,
                                        },
                                        billing: {
                                            planName: subscription.planName,
                                            basePrice: subscription.planPrice,
                                            additionalUsers: additionalUsers,
                                            additionalUserPrice: subscription.additionalUserPrice,
                                            additionalUsersTotal: additionalUsersTotal,
                                            total: result.invoice.amount,
                                            currency: subscription.currency || 'HNL',
                                        },
                                        isSecondUnpaidInvoice: result.isSecondUnpaidInvoice,
                                        unpaidCount: result.unpaidCount,
                                    }
                                );
                                this.logger.log(`📧 Notificación enviada a ${notificationEmail}`);
                            } else {
                                this.logger.warn(
                                    `⚠️ Clínica ${subscription.medicalClinicName} no tiene email registrado, no se envió notificación.`
                                );
                            }
                        } catch (emailError) {
                            this.logger.error(
                                `📧❌ Error enviando email:`,
                                emailError.message,
                                emailError.stack
                            );
                        }

                        successCount++;
                    } else {
                        this.logger.log(`⏭️  ${subscription.medicalClinicName}: ${validation.reason}`);
                        skippedCount++;
                    }

                    // Si tiene 2 facturas impagadas, considerar suspensión
                    if (validation.code === 'MAX_UNPAID_REACHED') {
                        this.logger.log(`⚠️ Evaluando suspensión para ${subscription.medicalClinicName}...`);
                        // Aquí podrías agregar lógica adicional para suspender después de X días
                    }

                } catch (error) {
                    this.logger.error(
                        `❌ Error procesando ${subscription.medicalClinicName}: ${error.message}`,
                        error.stack
                    );
                    errorCount++;
                }
            }

            // Resumen del proceso
            const endTime = new Date();
            const duration = endTime.getTime() - startTime.getTime();

            this.logger.log(`\n📊 [RESUMEN FACTURAS]:`);
            this.logger.log(`   ✅ Exitosas: ${successCount}`);
            this.logger.log(`   ⏭️ Omitidas: ${skippedCount}`);
            this.logger.log(`   ❌ Errores: ${errorCount}`);
            this.logger.log(`   ⏱️ Duración: ${duration}ms`);
            this.logger.log(`   🏁 Finalizado: ${endTime.toISOString()} \n`);
        } catch (error) {
            this.logger.error(
                '💥 [CRON FACTURAS] Error crítico en el proceso de facturación:',
                error.message,
                error.stack
            );
        }
    }

    // // Cron job de desarrollo - cada 10 segundos (comentar en producción)
    // // @Cron(CronExpression.EVERY_MINUTE)

    // async processBillingCronDev(): Promise<void> {
    //     this.logger.debug('🧪 [DESARROLLO] Ejecutando cron job de prueba...');
    //     await this.processBillingCron();
    // }


    // 🔄 DESHABILITADO: Ejecutar todos los días a las 10:15 AM (verificación de facturas vencidas y suspensiones)
    // @Cron('15 10 * * *')
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

                    if (invoices.length < 2) return null;

                    const firstInvoice = invoices[0];
                    const secondInvoice = invoices[1];
                    const secondInvoiceDate = new Date(secondInvoice.createdAt);
                    
                    // Calcular días desde la segunda factura
                    const daysOverdue = differenceInDays(new Date(), secondInvoiceDate);
                    
                    // Suspender exactamente al día 5 desde la segunda factura
                    const shouldSuspend = daysOverdue >= gracePeriodDays;

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
                .filter((clinic): clinic is ProcessedClinic => clinic !== null && clinic.shouldSuspend);

            this.logger.log(`📊 Clínicas encontradas para suspensión: ${clinicsToNotifyOrSuspend.length}`);

            // Procesar cada clínica que debe ser suspendida
            for (const clinic of clinicsToNotifyOrSuspend) {
                const actionMsg = `📋 Clínica: ${clinic.clinicName}, Facturas impagas: ${clinic.unpaidCount}, Días vencido: ${clinic.daysOverdue}`;

                this.logger.log(`🔄 Procesando: ${actionMsg}`);

                try {
                    // Desactivar la clínica
                    await this.deactivateClinicForNonPayment(
                        clinic.clinicId,
                        `🚫 Superó los ${gracePeriodDays} días tras segunda factura. Días vencido: ${clinic.daysOverdue}`
                    );

                    // Preparar emails para notificación
                    const emailsToNotify = [...new Set(clinic.adminEmails)];

                    if (emailsToNotify.length > 0) {
                        // Enviar notificación de suspensión
                        await this.notificationService.sendSuspensionNotification(emailsToNotify, clinic as any);

                        this.logger.log(`✅ Suspendida y notificada: ${actionMsg}\n`);
                    } else {
                        this.logger.warn(`⚠️ No se encontraron emails de admin para notificar: ${clinic.clinicName}`);
                    }

                } catch (err) {
                    this.logger.error(`❌ Error procesando ${clinic.clinicName}:`, err.message);
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