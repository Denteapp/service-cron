import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Doctor } from 'src/schema/task.schema';
import { Model } from 'mongoose';

@Injectable()
export class TasksService {
    constructor(@InjectModel('Doctor') private taskModel: Model<Doctor>) {} // Replace 'any' with the actual type of your model

    findAll() {
        return this.taskModel.find().exec();
    }
    create(createTask: any) {
        const task = new this.taskModel(createTask);
        return task.save();
    }
    findOne(id: string) {
        return this.taskModel.findById(id).exec();
    }
    update(id: string, updateTask: any) {
        return this.taskModel.findByIdAndUpdate(id, updateTask, { new: true }).exec();
    }
    remove(id: string) {
        return this.taskModel.findByIdAndDelete(id).exec();
    }
}
