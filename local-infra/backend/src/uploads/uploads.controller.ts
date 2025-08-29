import { Body, Controller, Post } from '@nestjs/common';
import { SignedUrlDto } from './dto/signed-url.dto';
import { S3Service } from '../common/s3/s3.service';

@Controller('uploads')
export class UploadsController {
  constructor(private s3: S3Service) {}

  @Post('signed-url')
  async createSignedUrl(@Body() dto: SignedUrlDto) {
    const bucket = process.env.S3_BUCKET_UPLOADS || 'uploads';
    const keyPrefix = `uploads/${dto.videoId}/`;
    const filename = 'input.mp4';
    const key = `${keyPrefix}${filename}`;

    const presigned = await this.s3.presignPost({
      bucket,
      key,
      contentType: dto.contentType,
      maxSize: Math.min(dto.fileSize, 10 * 1024 * 1024 * 1024), // hasta 10GB
      expiresIn: 300,
    });

    return {
      url: presigned.url,
      fields: presigned.fields,
      bucket,
      key,
      expiresIn: 300,
    };
  }
}