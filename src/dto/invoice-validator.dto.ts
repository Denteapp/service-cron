export class InvoiceValidationDto {
  canGenerate: boolean;
  reason?: string;
  code: string;
  unpaidCount?: number;
}

export class InvoiceGenerationResultDto {
  invoice: any;
  isSecondUnpaidInvoice: boolean;
  unpaidCount: number;
}
