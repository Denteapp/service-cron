import { IsString, IsBoolean, IsOptional, IsNotEmpty, IsEmail } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsBoolean()
  @IsOptional()
  review?: boolean;

  @IsString()
  @IsOptional()
  comment?: string;
}
