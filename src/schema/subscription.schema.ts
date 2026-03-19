import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Model, Types } from 'mongoose';

// Interfaz para métodos de instancia
export interface SubscriptionMethods {
  calculateTotalCost(): Promise<number>;
  isWithinLimit(limitType: string): boolean;
  getRemainingQuota(limitType: string): number;
  hasAccess(featureName: string): boolean;
  resetMonthlyUsage(): Promise<SubscriptionDocument>;
}

// Interfaz para métodos estáticos
export interface SubscriptionModel extends Model<SubscriptionDocument> {
  findExpiringSubscriptions(daysBeforeExpiration?: number): Promise<SubscriptionDocument[]>;
  suspendExpiredSubscriptions(): Promise<number>;
}

export type SubscriptionDocument = Subscription & Document & SubscriptionMethods & { _id: Types.ObjectId };

// Subdocumentos para organizar la estructura
class AILimits {
  @Prop({ default: 0 })
  monthlyAICredits: number;

  @Prop({ default: 0 })
  aiQueriesPerMonth: number;

  @Prop({ default: 0 })
  aiImageAnalysisPerMonth: number;
}

class PlanLimits {
  @Prop({ required: true })
  maxUsers: number;

  @Prop({ required: true })
  maxBranches: number;

  @Prop({ required: true })
  maxPatients: number;

  @Prop({ required: true })
  maxStorage: number; // GB

  @Prop({ default: 0 })
  whatsappMessages: number;

  @Prop({ type: AILimits, default: () => ({}) })
  aiLimits: AILimits;
}

class PlanFeatures {
  @Prop({ default: false })
  hasInventoryModule: boolean;

  @Prop({ default: false })
  hasAdvancedReports: boolean;

  @Prop({ default: false })
  hasMultipleBranches: boolean;

  @Prop({ default: false })
  hasAdvertising: boolean;

  @Prop({ default: false })
  hasAIAssistant: boolean;

  @Prop({ default: false })
  hasAIDiagnosisSupport: boolean;

  @Prop({ default: false })
  hasAIImageAnalysis: boolean;

  @Prop({ default: false })
  hasWhatsappNotifications: boolean;

  @Prop({ default: true })
  hasEmailNotifications: boolean;

  @Prop({ default: false })
  hasOnlineScheduling: boolean;
}

class CurrentUsage {
  @Prop({ default: 0 })
  usersCount: number;

  @Prop({ default: 1 })
  branchesCount: number;

  @Prop({ default: 0 })
  patientsCount: number;

  @Prop({ default: 0 })
  storageUsed: number; // Bytes

  @Prop({ default: 0 })
  whatsappMessagesUsed: number;

  @Prop({ default: 0 })
  emailsSentCount: number;

  @Prop({ default: 0 })
  aiCreditsUsed: number;

  @Prop({ default: 0 })
  aiQueriesUsed: number;

  @Prop({ default: 0 })
  aiImageAnalysisUsed: number;
}

class AddOnService {
  @Prop({ default: false })
  isActive: boolean;

  @Prop()
  activatedAt?: Date;

  @Prop({ default: 0 })
  monthlyCost: number;
}

class AIAddOnService extends AddOnService {
  @Prop({ default: 0 })
  extraCredits?: number;

  @Prop({ default: 0 })
  extraAnalysis?: number;
}

class AddOnServices {
  @Prop({ type: AddOnService, default: () => ({}) })
  whatsappNotifications: AddOnService;

  @Prop({ type: AddOnService, default: () => ({}) })
  digitalSignature: AddOnService;

  @Prop({ type: AIAddOnService, default: () => ({}) })
  aiAssistantPremium: AIAddOnService;

  @Prop({ type: AIAddOnService, default: () => ({}) })
  aiImageAnalysisPro: AIAddOnService;
}

@Schema({ timestamps: true })
export class Subscription extends Document {
  @Prop({ type: Types.ObjectId, ref: 'MedicalClinic', required: true, unique: true })
  medicalClinic: Types.ObjectId;

  @Prop({ required: true })
  medicalClinicName: string;

  @Prop({ type: Types.ObjectId, ref: 'SubscriptionPlan' })
  plan?: Types.ObjectId;

  @Prop({ 
    type: String, 
    enum: ['Inicial', 'Avanzado', 'Empresarial'], 
    required: true 
  })
  planName: string;

  @Prop({ 
    type: String, 
    enum: ['Mensual', 'Semestral', 'Anual'], 
    required: true 
  })
  billingFrequency: string;

  @Prop({ type: PlanLimits, required: true })
  planLimits: PlanLimits;

  @Prop({ type: PlanFeatures, required: true })
  planFeatures: PlanFeatures;

  @Prop({ 
    type: String, 
    enum: ['active', 'suspended', 'expired', 'trial'], 
    default: 'trial' 
  })
  status: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop()
  trialEndDate?: Date;

  @Prop({ type: CurrentUsage, default: () => ({}) })
  currentUsage: CurrentUsage;

  @Prop({ type: AddOnServices, default: () => ({}) })
  addOnServices: AddOnServices;

  @Prop({ default: 0 })
  totalWhatsappCost: number;

  @Prop({ default: 0 })
  totalAddOnsCost: number;

  @Prop({ default: () => new Date() })
  lastUsageReset: Date;

  @Prop()
  nextBillingDate?: Date;

  @Prop()
  country?: string;

  @Prop()
  currency?: string;

  @Prop({ required: true })
  planPrice: number;

  @Prop({ required: true })
  additionalUserPrice: number;

  @Prop({ default: true })
  isAutoRenewal: boolean;

  @Prop()
  suspensionReason?: string;

  @Prop()
  notes?: string;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

// Índices
// SubscriptionSchema.index({ medicalClinic: 1 }); // Comentado: ya existe índice único en @Prop
SubscriptionSchema.index({ status: 1, endDate: 1 });

// ===== MÉTODOS DE INSTANCIA =====

// Verificar si está dentro de un límite específico
SubscriptionSchema.methods.isWithinLimit = function(limitType: string): boolean {
  const limitMap = {
    users: { current: this.currentUsage.usersCount, max: this.planLimits.maxUsers },
    branches: { current: this.currentUsage.branchesCount, max: this.planLimits.maxBranches },
    patients: { current: this.currentUsage.patientsCount, max: this.planLimits.maxPatients },
    storage: { current: this.currentUsage.storageUsed / (1024 * 1024 * 1024), max: this.planLimits.maxStorage },
    whatsapp: { current: this.currentUsage.whatsappMessagesUsed, max: this.planLimits.whatsappMessages },
    aiQueries: { current: this.currentUsage.aiQueriesUsed, max: this.planLimits.aiLimits?.aiQueriesPerMonth || 0 },
    aiImageAnalysis: { current: this.currentUsage.aiImageAnalysisUsed, max: this.planLimits.aiLimits?.aiImageAnalysisPerMonth || 0 }
  };

  const limit = limitMap[limitType];
  if (!limit) return false;
  
  return limit.max === -1 || limit.current < limit.max;
};

// Obtener cuota restante
SubscriptionSchema.methods.getRemainingQuota = function(limitType: string): number {
  const limitMap = {
    users: { current: this.currentUsage.usersCount, max: this.planLimits.maxUsers },
    branches: { current: this.currentUsage.branchesCount, max: this.planLimits.maxBranches },
    storage: { current: this.currentUsage.storageUsed / (1024 * 1024 * 1024), max: this.planLimits.maxStorage },
    whatsapp: { current: this.currentUsage.whatsappMessagesUsed, max: this.planLimits.whatsappMessages },
    aiQueries: { current: this.currentUsage.aiQueriesUsed, max: this.planLimits.aiLimits?.aiQueriesPerMonth || 0 },
    aiImageAnalysis: { current: this.currentUsage.aiImageAnalysisUsed, max: this.planLimits.aiLimits?.aiImageAnalysisPerMonth || 0 }
  };

  const limit = limitMap[limitType];
  if (!limit) return 0;
  if (limit.max === -1) return Infinity;
  
  return Math.max(0, limit.max - limit.current);
};

// Calcular costo total (plan + usuarios adicionales)
SubscriptionSchema.methods.calculateTotalCost = async function(): Promise<number> {
  // Precio base del plan (incluye el primer usuario/administrador)
  const baseCost = this.planPrice || 0;
  
  // Obtener cantidad de usuarios actuales
  const totalUsers = this.currentUsage.usersCount || 0;
  
  // Calcular usuarios adicionales (restar 1 porque el primer usuario viene con el plan base)
  // Si tiene 1 usuario: 1 - 1 = 0 usuarios adicionales → solo paga plan base
  // Si tiene 2 usuarios: 2 - 1 = 1 usuario adicional → paga plan base + 1 profesional
  const additionalUsers = Math.max(0, totalUsers - 1);
  
  // Costo por usuarios adicionales
  const additionalUsersCost = additionalUsers * (this.additionalUserPrice || 0);
  
  // Total mensual: precio base + costo de usuarios adicionales
  // Ejemplo: 800 (base) + (2 usuarios adicionales * 1000) = 2,800
  return baseCost + additionalUsersCost;
};

// Verificar si tiene acceso a una feature (plan base + add-ons)
SubscriptionSchema.methods.hasAccess = function(featureName: string): boolean {
  // Verificar feature del plan base
  if (this.planFeatures[featureName]) return true;

  // Verificar si está activo como add-on
  const addOnMap = {
    hasWhatsappNotifications: this.addOnServices.whatsappNotifications?.isActive,
    hasDigitalSignature: this.addOnServices.digitalSignature?.isActive,
    hasAIAssistant: this.addOnServices.aiAssistantPremium?.isActive,
    hasAIImageAnalysis: this.addOnServices.aiImageAnalysisPro?.isActive
  };

  return addOnMap[featureName] || false;
};

// Resetear contadores mensuales
SubscriptionSchema.methods.resetMonthlyUsage = function(): Promise<SubscriptionDocument> {
  this.currentUsage.whatsappMessagesUsed = 0;
  this.currentUsage.emailsSentCount = 0;
  this.currentUsage.aiCreditsUsed = 0;
  this.currentUsage.aiQueriesUsed = 0;
  this.currentUsage.aiImageAnalysisUsed = 0;
  this.totalWhatsappCost = 0;
  this.lastUsageReset = new Date();
  return this.save();
};

// ===== MÉTODOS ESTÁTICOS =====

// Obtener suscripciones que expiran pronto
SubscriptionSchema.statics.findExpiringSubscriptions = function(daysBeforeExpiration = 7) {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + daysBeforeExpiration);
  
  return this.find({
    status: 'active',
    endDate: { $lte: expirationDate },
    isAutoRenewal: false
  }).populate('medicalClinic', 'medicalClinicName email');
};

// Suspender suscripciones expiradas
SubscriptionSchema.statics.suspendExpiredSubscriptions = async function() {
  const now = new Date();
  
  const result = await this.updateMany(
    {
      status: 'active',
      endDate: { $lt: now }
    },
    {
      status: 'expired',
      suspensionReason: 'Suscripción expirada'
    }
  );
  
  return result.modifiedCount;
};
