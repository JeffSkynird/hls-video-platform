import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { S3Module } from '../common/s3/s3.module';
import { UploadsConsumer } from './uploads.consumer';

@Module({ imports: [S3Module], controllers: [UploadsController], providers: [UploadsConsumer] })

export class UploadsModule {}