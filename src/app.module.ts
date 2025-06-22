import { Module } from '@nestjs/common';
import { TasksModule } from './tasks/tasks.module';
import { MongooseModule } from '@nestjs/mongoose';
import { SchedulerModule } from './scheduler/scheduler.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InvoicesModule } from './invoices/invoices.module';
import { NotificationService } from './notification/notification.service';



@Module({
  imports: [
     ConfigModule.forRoot({ isGlobal: true }),
     MongooseModule.forRootAsync({
       imports: [ConfigModule],
       useFactory: async (configService: ConfigService) => ({
         uri: configService.get<string>('MONGODB_URI') || '',
       }),
       inject: [ConfigService],
     }),
    //  TasksModule, 
     SchedulerModule, 
     InvoicesModule],
  providers: [NotificationService],
})
export class AppModule {}
