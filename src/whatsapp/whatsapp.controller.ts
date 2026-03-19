import { Controller, Get, Post, Query, Body, Logger, HttpCode, HttpStatus } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { ConfigService } from '@nestjs/config';

interface WebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      contacts?: Array<{
        profile: {
          name: string;
        };
        wa_id: string;
      }>;
      messages?: Array<{
        from: string;
        id: string;
        timestamp: string;
        type: string;
        button?: {
          payload: string;
          text: string;
        };
        interactive?: {
          type: string;
          button_reply?: {
            id: string;
            title: string;
          };
        };
        text?: {
          body: string;
        };
      }>;
      statuses?: Array<{
        id: string;
        status: string;
        timestamp: string;
        recipient_id: string;
        conversation?: {
          id: string;
          origin: {
            type: string;
          };
        };
        pricing?: {
          billable: boolean;
          pricing_model: string;
          category: string;
        };
      }>;
    };
    field: string;
  }>;
}

interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

@Controller('webhook')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);
  private readonly verifyToken: string;

  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly configService: ConfigService,
  ) {
    this.verifyToken = this.configService.get<string>('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN') || '';
  }

  /**
   * Endpoint GET para verificación del webhook de Meta
   * Meta envía una petición GET con query parameters para verificar el webhook
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && token === this.verifyToken) {
      return challenge;
    }

    throw new Error('Verification failed');
  }

  /**
   * Endpoint POST para recibir webhooks de Meta cuando hay interacciones
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() payload: WebhookPayload): Promise<{ status: string }> {
    try {
      if (payload.object !== 'whatsapp_business_account') {
        return { status: 'ignored' };
      }
      
      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          const value = change.value;

          if (value.statuses && value.statuses.length > 0) {
            for (const status of value.statuses) {
              if (status.status === 'delivered') {
                this.logger.log(`📬 Mensaje entregado al +${status.recipient_id} - ID: ${status.id}`);
                
                // Actualizar estado en base de datos
                await this.whatsappService.handleMessageStatusUpdate(
                  status.id,
                  'delivered',
                  status.recipient_id,
                  status.timestamp,
                ).catch(err => {
                  this.logger.error(`Error actualizando estado delivered: ${err.message}`);
                });
              } else if (status.status === 'read') {
                this.logger.log(`👀 Mensaje leído por +${status.recipient_id} - ID: ${status.id}`);
                
                // Actualizar estado en base de datos
                await this.whatsappService.handleMessageStatusUpdate(
                  status.id,
                  'read',
                  status.recipient_id,
                  status.timestamp,
                ).catch(err => {
                  this.logger.error(`Error actualizando estado read: ${err.message}`);
                });
              }
            }
            
            continue;
          }

          if (!value.messages || value.messages.length === 0) {
            continue;
          }
          
          for (const message of value.messages) {
            if (message.type === 'button' && message.button?.payload) {
              const buttonId = message.button.payload;
              const phoneNumber = message.from;
              this.logger.log(`🔔 Botón presionado: ${message.button.text} - Tel: ${phoneNumber}`);
              await this.whatsappService.handleButtonResponse(buttonId, phoneNumber);
            }
            else if (message.type === 'interactive' && message.interactive?.button_reply) {
              const buttonId = message.interactive.button_reply.id;
              const phoneNumber = message.from;

              this.logger.log(`🔔 Botón presionado: ${message.interactive.button_reply.title} - Tel: ${phoneNumber}`);
              await this.whatsappService.handleButtonResponse(buttonId, phoneNumber);
            }
          }
        }
      }

      return { status: 'success' };
    } catch (error) {
      this.logger.error(`❌ Error procesando webhook:`, error.message);
      this.logger.error(`   └─ Stack: ${error.stack}`);
      return { status: 'error' };
    }
  }
}



