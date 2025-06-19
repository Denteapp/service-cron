import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { addDays, addMonths, differenceInDays, format, subDays, subMonths } from 'date-fns';
import { MedicalClinic, MedicalClinicDocument, MedicalClinicWithAdmin } from '../schema/medicalClinic.schema';
import { canGenerateInvoiceCode, Payment, PaymentDocument, PaymentState } from '../schema/payment.schema';
import { NotificationService } from '../notification/notification.service';
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

        return this.medicalClinicModel.aggregate([
            {
                $match: {
                    expiredSubsDate: {
                        $gte: currentDate,
                        $lt: fiveDaysFromNow
                    },
                    isActive: true,
                    paymentState: 'Gratis'
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


        // return this.medicalClinicModel.find({
        //     expiredSubsDate: { 
        //         $gte: currentDate,          // Fecha mayor o igual a hoy
        //         $lt: fiveDaysFromNow       // Fecha menor a 5 días en el futuro
        //     },
        //     isActive: true,
        //     paymentState: 'Gratis',

        // });
    }

    // Contar facturas impagadas para una clínica
    async countUnpaidInvoices(clinicId: string): Promise<number> {

        // this.logger.debug(`Contando facturas impagadas para clínica: ${clinicId}`);

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

        console.log(hasCurrentPeriodInvoice, "canGenerateInvoice");


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
    async deactivateClinicForNonPayment(
        clinicId: string,
        reason = 'Facturas impagadas',
    ): Promise<MedicalClinicDocument | null> {
        const clinic = await this.medicalClinicModel.findByIdAndUpdate(
            clinicId,
            {
                // isActive: false,
                paymentState: 'Gratis',
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
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `TX-${timestamp}-${clinicId}-${random}`;
    }

    // Generar referencia externa única
    private generateExternalReference(period: string, clinicId: string): string {
        const random = Math.random().toString(36).substr(2, 6).toUpperCase();
        return `REF-${clinicId}-${random}`;
    }

    // Generar la factura con todas las validaciones
    // async generateInvoice(clinicData: MedicalClinicDocument): Promise<InvoiceGenerationResultDto> {
    //     const currentPeriod = this.getCurrentPeriod();

    //     // Verificar si ya existe factura para este período
    //     const existingInvoice = await this.paymentModel.findOne({
    //         medicalClinic: clinicData._id,
    //         period: currentPeriod,
    //     });

    //     if (existingInvoice) {
    //         throw new Error(`Ya existe una factura generada para el período ${currentPeriod}`);
    //     }

    //     // Validar si se puede generar la factura
    //     const validation = await this.canGenerateInvoice(clinicData._id.toString());
    //     if (!validation.canGenerate) {
    //         throw new Error(`No se puede generar factura: ${validation.reason}`);
    //     }

    //     // Determinar si es la segunda factura impagada
    //     const isSecondUnpaidInvoice = validation.unpaidCount === 1;



    //     // Crear la factura
    //     const initialPrice = 800;
    //     const additionalPricePerProfessional = 200;
    //     const licenceUser = clinicData.licenceUser ?? 1;
    //     const totalPrice = initialPrice + (licenceUser - 1) * additionalPricePerProfessional;

    //     const invoice = new this.paymentModel({
    //         medicalClinic: clinicData._id,
    //         amount: totalPrice, // <--- Ahora el precio es dinámico
    //         description: `Factura mensual - ${clinicData.medicalClinicName} (${currentPeriod})`,
    //         period: currentPeriod,
    //         user: '', 
    //         paymentState: PaymentState.GENERATED, // Pendiente
    //         transactionID: this.generateTransactionID(clinicData._id.toString()),
    //         bankName: '',
    //         externalReference: this.generateExternalReference(currentPeriod, clinicData._id.toString()),
    //         holderName: clinicData.medicalClinicName,
    //         recipientImg: '',
    //         paymentMethod: 'Transferencia',
    //         last4Digits: '0000',
    //         paidAt: null, // Aún no pagada
    //         transferDate: new Date().toISOString(),

    //         isAutomatic: true, // Marca esta factura como generada automáticamente
    //         generatedBy: 'Automatico', // Nombre del generador visible
    //         issuedDate: new Date().toISOString(), // Fecha de emisión visible
    //         billingCycle: 'Mensual', // Ciclo de facturación visible
    //         displayStatus: 'Factura emitida, pago en espera', // Estado visible
    //     });

    //     await invoice.save();

    //     this.logger.log(`✅ Factura generada: ${invoice.transactionID} para ${clinicData.medicalClinicName}`);

    //     // Alertas especiales
    //     if (isSecondUnpaidInvoice) {
    //         this.logger.warn(`⚠️  ALERTA: ${clinicData.medicalClinicName} tiene 2 facturas impagadas. Próxima acción: suspensión.`);
    //     }

    //     return {
    //         invoice: invoice.toObject(),
    //         isSecondUnpaidInvoice,
    //         unpaidCount: (validation.unpaidCount ?? 0) + 1, // +1 porque acabamos de crear una nueva
    //     };
    // }

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

        // ACTUALIZAR LA FECHA DE EXPIRACIÓN DE LA SUSCRIPCIÓN - AÑADIR UN MES CON DATE-FNS
        const currentExpiredDate = clinicData.expiredSubsDate;
        const newExpiredSubsDate = addMonths(currentExpiredDate, 1);

        // await this.medicalClinicModel.findByIdAndUpdate(
        //     clinicData._id,
        //     {
        //         expiredSubsDate: newExpiredSubsDate,
        //         // También podrías actualizar el paymentState si es necesario
        //         // paymentState: 'Pago' // o el estado que corresponda
        //     },
        //     { new: true }
        // );

        this.logger.log(`✅ Factura generada para ${clinicData.medicalClinicName}`);
        this.logger.log(`📅 Nueva fecha de expiración para ${clinicData.medicalClinicName}: ${newExpiredSubsDate.toISOString()} X   actualizar clinica`);

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
    // @Cron('0 9 * * *') // Producción
    async processBillingCron(): Promise<void> {

        const startTime = new Date();

        this.logger.log(`🚀 Iniciando proceso de facturación - ${startTime.toISOString()}`);

        try {
            // 1. Buscar clínicas que necesiten facturación
            // Use the correct type for clinics with adminEmails/adminNames
            type ClinicWithAdmins = MedicalClinicDocument & { adminEmails?: string[]; adminNames?: string[] };
            const clinicsToInvoice = await this.findClinicsToInvoice() as ClinicWithAdmins[];

            // console.log(`🔍 Clínicas encontradas: ${clinicsToInvoice}`);

            this.logger.log(`📋 Encontradas ${clinicsToInvoice.length}  clínicas para procesar`);
            // this.logger.log(`📋 Clinica ${clinicsToInvoice} `);

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

                    this.logger.log(`1) Procesando: ${clinic.medicalClinicName}`);

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

                    this.logger.log(`2) Validación para ${clinic.medicalClinicName}`);
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

                        // console.log(result, 'result');
                        // console.log("---------------------------------------------------");
                        // console.log(clinic, 'clinic');

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

                    // if (validation.canGenerate) {
                    //     // 3. Generar factura
                    //     const result = await this.generateInvoice(clinic);

                    //     console.log(result, 'result');
                    //     console.log("---------------------------------------------------");

                    //     console.log(clinic, 'clinic');


                    //     // 4. Enviar notificación por email
                    //     try {
                    //         if (clinic.email) {
                    //             await this.notificationService.sendInvoiceNotification(clinic.email, result.invoice);
                    //             this.logger.log(`📧 Notificación enviada a ${clinic.email}`);
                    //         } else {
                    //             this.logger.warn(`⚠️ Clínica ${clinic.medicalClinicName} no tiene email registrado, no se envió notificación.`);
                    //         }
                    //     } catch (emailError) {
                    //         this.logger.error(`📧❌ Error enviando email a ${clinic.email}:`, emailError.message);
                    //     }

                    //     successCount++;
                    // } else {
                    //     this.logger.log(`⏭️  ${clinic.medicalClinicName}: ${validation.reason}`);
                    //     skippedCount++;
                    // }

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
            this.logger.log(`   🏁 Finalizado: ${endTime.toISOString()}`);
        } catch (error) {
            this.logger.error('💥 Error crítico en el proceso de facturación:', error);
        }
    }

    // Cron job de desarrollo - cada 10 segundos (comentar en producción)
    // @Cron('*/30 * * * * *')
    @Cron('*/30 * * * * *')

    async processBillingCronDev(): Promise<void> {
        this.logger.debug('🧪 [DESARROLLO] Ejecutando cron job de prueba...');
        await this.processBillingCron();
    }

    // Cron job para verificar facturas vencidas - ejecutar semanalmente los lunes a las 10:00 AM
    // @Cron('*/30 * * * * *')
    // async checkOverdueInvoices(): Promise<void> {
    //     this.logger.log('🔍 Iniciando verificación de facturas vencidas y suspensión por segunda factura...');

    //     const invoiceGracePeriod = 30; // 30 días para facturas vencidas
    //     const secondInvoiceSuspensionDays = 15; // 15 días para suspender tras segunda factura
    //     const overdueDate = subDays(new Date(), invoiceGracePeriod);
    //     const secondInvoiceCutoff = subDays(new Date(), secondInvoiceSuspensionDays);

    //     try {
    //         // 1. Buscar clínicas con facturas impagadas
    //         const clinicsWithUnpaid = await this.paymentModel.aggregate([
    //             {
    //                 $match: {
    //                     paymentState: PaymentState.PENDING,
    //                 }
    //             },
    //             {
    //                 $group: {
    //                     _id: "$medicalClinic",
    //                     unpaidCount: { $sum: 1 },
    //                     secondInvoiceDate: {
    //                         $min: {
    //                             $cond: [
    //                                 { $eq: ["$unpaidCount", 2] },
    //                                 "$createdAt",
    //                                 null
    //                             ]
    //                         }
    //                     },
    //                     latestInvoiceDate: { $max: "$createdAt" },
    //                     clinicData: { $first: "$$ROOT" }
    //                 }
    //             },
    //             {
    //                 $lookup: {
    //                     from: "clinics",
    //                     localField: "_id",
    //                     foreignField: "_id",
    //                     as: "clinicInfo"
    //                 }
    //             },
    //             {
    //                 $unwind: "$clinicInfo"
    //             },
    //             {
    //                 $match: {
    //                     "clinicInfo.isActive": true
    //                 }
    //             }
    //         ]);

    //         this.logger.log(`📋 Encontradas ${clinicsWithUnpaid.length} clínicas con facturas impagadas`);

    //         const clinicsToSuspend: {
    //             id: string;
    //             name: string;
    //             email: string;
    //             reason: string;
    //             trigger: string;
    //         }[] = [];

    //         for (const clinic of clinicsWithUnpaid) {
    //             const clinicId = clinic._id;
    //             const unpaidCount = clinic.unpaidCount;
    //             const secondInvoiceDate = clinic.secondInvoiceDate;
    //             const latestInvoiceDate = clinic.latestInvoiceDate;

    //             // Criterio 1: Suspender si han pasado 15 días desde la segunda factura impagada
    //             if (unpaidCount === 2 && secondInvoiceDate && secondInvoiceDate <= secondInvoiceCutoff) {
    //                 clinicsToSuspend.push({
    //                     id: clinicId.toString(),
    //                     name: clinic.clinicInfo.medicalClinicName,
    //                     email: clinic.clinicInfo.email,
    //                     reason: `Segunda factura impagada generada el ${format(secondInvoiceDate, 'dd/MM/yyyy')} (hace más de 15 días)`,
    //                     trigger: "SECOND_INVOICE_TIMEOUT"
    //                 });
    //             }
    //             // Criterio 2: 3+ facturas impagadas (suspensión inmediata)
    //             else if (unpaidCount >= 3) {
    //                 clinicsToSuspend.push({
    //                     id: clinicId,
    //                     name: clinic.clinicInfo.medicalClinicName,
    //                     email: clinic.clinicInfo.email,
    //                     reason: `${unpaidCount} facturas impagadas`,
    //                     trigger: "MAX_UNPAID_EXCEEDED"
    //                 });
    //             }
    //             // Criterio 3: Última factura vencida (>30 días)
    //             else if (latestInvoiceDate <= overdueDate) {
    //                 clinicsToSuspend.push({
    //                     id: clinicId,
    //                     name: clinic.clinicInfo.medicalClinicName,
    //                     email: clinic.clinicInfo.email,
    //                     reason: `Última factura impagada generada el ${format(latestInvoiceDate, 'dd/MM/yyyy')}`,
    //                     trigger: "LAST_INVOICE_OVERDUE"
    //                 });
    //             }
    //         }

    //         // 2. Suspender clínicas
    //         for (const clinic of clinicsToSuspend) {
    //             try {
    //                 await this.deactivateClinicForNonPayment(clinic.id, clinic.reason);
    //                 this.logger.warn(`🚫 Clínica suspendida: ${clinic.name} | Razón: ${clinic.reason}`);

    //                 // Enviar notificación específica
    //                 if (clinic.trigger === "SECOND_INVOICE_TIMEOUT") {
    //                     this.logger.error(`⚠️ Clínica ${clinic.name} suspendida por segunda factura impagada (más de 15 días)`);

    //                     // this.notificationService.sendSuspensionWarning(
    //                     //     clinic.email,
    //                     //     secondInvoiceSuspensionDays
    //                     // );
    //                 }
    //             } catch (error) {
    //                 this.logger.error(`❌ Error suspendiendo ${clinic.name}:`, error.message);
    //             }
    //         }

    //         this.logger.log(`✅ Verificación completada: ${clinicsToSuspend.length} suspensiones aplicadas`);
    //     } catch (error) {
    //         this.logger.error('💥 Error crítico en verificación de facturas:', error);
    //     }
    // }
    // async checkOverdueInvoices(): Promise<void> {
    //     this.logger.log('🔍 Iniciando verificación de facturas vencidas...');

    //     const gracePeriodDays = 30; // 30 días de gracia
    //     const overdueDate = subDays(new Date(), gracePeriodDays);

    //     try {
    //         // Buscar facturas vencidas no pagadas
    //         const overdueInvoices = await this.paymentModel
    //             .find({
    //                 paymentState: 0, // Pendiente
    //                 createdAt: { $lt: overdueDate },
    //             })
    //             .populate('medicalClinic');

    //         this.logger.log(`📋 Encontradas ${overdueInvoices.length} facturas vencidas (>${gracePeriodDays} días)`);

    //         const clinicsToSuspend = new Set(); // Evitar duplicados

    //         for (const invoice of overdueInvoices) {
    //             if (!invoice.medicalClinic) continue;

    //             const clinicId = (invoice.medicalClinic as any)._id.toString();
    //             const unpaidCount = await this.countUnpaidInvoices(clinicId);

    //             if (unpaidCount >= 2 && (invoice.medicalClinic as any).isActive) {
    //                 clinicsToSuspend.add({
    //                     id: clinicId,
    //                     name: (invoice.medicalClinic as any).medicalClinicName,
    //                     email: (invoice.medicalClinic as any).email,
    //                     unpaidCount,
    //                 });
    //             }
    //         }

    //         // Suspender clínicas
    //         for (const clinic of clinicsToSuspend) {
    //             try {
    //                 await this.deactivateClinicForNonPayment(
    //                     (clinic as any).id,
    //                     `${(clinic as any).unpaidCount} facturas vencidas (>${gracePeriodDays} días)`,
    //                 );
    //             } catch (error) {
    //                 this.logger.error(`❌ Error suspendiendo ${(clinic as any).name}:`, error.message);
    //             }
    //         }

    //         // const resultado = await Promise.all(clinicsToSuspend);

    //         this.logger.log(`🚫 ${clinicsToSuspend.size} clínicas suspendidas por facturas vencidas`);
    //     } catch (error) {
    //         this.logger.error('💥 Error verificando facturas vencidas:', error);
    //     }
    // }

    async checkOverdueInvoices(): Promise<void> {
        this.logger.log('🔍 Iniciando evaluación de facturas impagas...');

        const gracePeriodDays = 3; // Días de gracia después de la segunda factura
        const overdueDate = subDays(new Date(), gracePeriodDays); //TODO: Revisar si este valor debe de ser 5 dias mas, ya que se debe de validar 5 dias despues de la segunda factura
        // console.log(overdueDate, 'overdueDate'); // 31 

        try {
            // Consulta única que obtiene clínicas con facturas impagas, información de la clínica y usuarios admin
            const clinicsWithUnpaidAndUsers = await this.paymentModel.aggregate([
                {
                    $match: {
                        paymentState: 4,
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
                        from: 'medicalclinics', // ajusta el nombre de la colección
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

            const clinicsToNotifyOrSuspend: Array<{
                clinicId: any;
                clinicName: string;
                clinicEmail: string | undefined;
                adminEmails: string[];
                adminNames: string[];

                shouldSuspend: boolean;
                daysOverdue: number;
                firstInvoiceInfo: {
                    createdAt: any;
                    amount: number;
                    period: any;
                    comment: any;
                    displayComment: any;
                };
                secondInvoiceInfo: {
                    createdAt: any;
                    period: any;
                    amount: number;
                    comment: any;
                    displayComment: any;
                };
                unpaidCount: number;
                clinicDetails: {
                    country: string;
                    plan: string;
                    avatar: string;
                    licenceUser: number;
                    expiredSubsDate: Date;
                };
            }> = [];


            for (const group of clinicsWithUnpaidAndUsers) {
                const clinicId = group._id;
                const invoices = group.unpaidInvoices;

                // La segunda factura será la clave para la evaluación
                const firtsInvoice = invoices[0];
                const firtsInvoiceDate = new Date(firtsInvoice.createdAt);
                const secondInvoice = invoices[1];
                const secondInvoiceDate = new Date(secondInvoice.createdAt);

                console.log(firtsInvoiceDate, 'firstInvoiceDate');
                console.log(secondInvoiceDate, 'secondInvoiceDate');  //2025-05-17T15:40:32.671Z secondInvoiceDate
                


                const shouldSuspend = secondInvoiceDate < overdueDate;

                console.log(overdueDate, 'overdueDate');                    //31 daysOverdue
                console.log(secondInvoiceDate, 'secondInvoiceDate');        //31 daysOverdue

                const daysOverdue = differenceInDays(new Date(), secondInvoiceDate);

                console.log(shouldSuspend, 'shouldSuspend');    //true shouldSuspend
                // console.log(daysOverdue, 'daysOverdue');        //31 daysOverdue

                clinicsToNotifyOrSuspend.push({
                    clinicId,
                    clinicName: group.clinicName,
                    clinicEmail: group.clinicEmail,
                    adminEmails: group.adminEmails || [],
                    adminNames: group.adminNames || [],

                    shouldSuspend,
                    daysOverdue,
                    firstInvoiceInfo: {
                        createdAt: firtsInvoice.createdAt,
                        period: firtsInvoice.period,
                        comment: firtsInvoice.comment,
                        amount: firtsInvoice.amount,
                        displayComment: firtsInvoice.displayStatus,
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
                    }
                });
            }

            for (const clinic of clinicsToNotifyOrSuspend) {
                const actionMsg = `📋 Clínica: ${clinic.clinicName}, Facturas impagas: ${clinic.unpaidCount}, Admins: ${clinic.adminNames.join(', ')}`;

                console.log(clinic, "clinicas");
                

                if (clinic.shouldSuspend) {
                    try {
                        await this.deactivateClinicForNonPayment(
                            clinic.clinicId,
                            `🚫 Superó los ${gracePeriodDays} días tras segunda factura.`,
                        );

                        // Enviar notificación de suspensión a la clínica y a todos los admins
                        const emailsToNotify = [  ...(clinic.clinicEmail ? [clinic.clinicEmail] : []),
                        ...clinic.adminEmails
                        ].filter((email, index, arr) => arr.indexOf(email) === index); // Remover duplicados

                        // OPCIÓN 1: Enviar el objeto clinic completo
                        for (const email of emailsToNotify) {

                            await this.notificationService.sendSuspensionNotification(email, clinic as any);
                        }

                        this.logger.log(`✅ Suspendida y notificada: ${actionMsg}`);
                    } catch (err) {
                        this.logger.error(`❌ Error suspendiendo ${clinic.clinicName}:`, err.message);
                    }
                } 
            }
            this.logger.log(`🏁 Evaluación completa. Clínicas procesadas: ${clinicsToNotifyOrSuspend.length}`);
        } catch (error) {
            this.logger.error('💥 Error al evaluar facturas impagas:', error);
        }
    }
     
}