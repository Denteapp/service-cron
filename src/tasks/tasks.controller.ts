import { Body, Controller, Get, Post, Param, Delete } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from 'src/dto/create-task.dto';

@Controller('tasks')
export class TasksController {
    constructor(private tasksService: TasksService) { } // Inject the service here
    @Get()
    getAllTasks() {
        return this.tasksService.findAll();
    }
    @Delete(':id')
    deleteTask(@Param('id') id: string) {
        return this.tasksService.remove(id);
    }

    @Post()
    createTask(@Body() createTask: CreateTaskDto) { // Replace 'any' with the actual type of your DTO
        console.log('createTask', createTask);
        return this.tasksService.create(createTask);
    }

    
}
