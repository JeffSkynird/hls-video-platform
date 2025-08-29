import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateVideoDto {
  @IsString()
  title!: string;

  @IsArray()
  @IsOptional()
  tags?: string[];
}