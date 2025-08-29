import { IsIn, IsInt, IsPositive, IsString } from 'class-validator';

export class SignedUrlDto {
  @IsString() videoId!: string;

  @IsString()
  @IsIn(['video/mp4', 'video/quicktime'])
  contentType!: string;

  @IsInt() @IsPositive()
  fileSize!: number; // bytes
}