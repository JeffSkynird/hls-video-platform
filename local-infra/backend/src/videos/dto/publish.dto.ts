import { IsIn } from 'class-validator';
export class PublishDto {
  @IsIn(['public', 'private'])
  visibility!: 'public' | 'private';
}