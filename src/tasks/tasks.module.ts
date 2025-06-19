import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Doctor, DoctorSchema } from 'src/schema/task.schema';

@Module({
  imports: [MongooseModule.forFeature([
    { 
      name: Doctor.name, 
      schema: DoctorSchema 
    }
    ])],
  controllers: [TasksController],
  providers: [TasksService]
})
export class TasksModule {}
