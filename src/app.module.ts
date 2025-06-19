import { Module } from '@nestjs/common';
import { TasksModule } from './tasks/tasks.module';
import { MongooseModule } from '@nestjs/mongoose';
import { SchedulerModule } from './scheduler/scheduler.module';
import { InvoicesModule } from './invoices/invoices.module';
import { NotificationService } from './notification/notification.service';

@Module({
  imports: [MongooseModule.forRoot('mongodb+srv://astrotechhn:Rdashking...123@denteapptest.1tcgvon.mongodb.net/?retryWrites=true&w=majority'), TasksModule, SchedulerModule, InvoicesModule],
  providers: [NotificationService],
})
export class AppModule {}
