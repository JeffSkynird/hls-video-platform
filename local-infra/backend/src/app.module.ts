import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { VideosModule } from './videos/videos.module';
import { UploadsModule } from './uploads/uploads.module';
import { S3Module } from './common/s3/s3.module';
import { RedisModule } from './common/redis/redis.module';
import { RabbitMQModule } from './common/rabbitmq/rabbitmq.module';
import { MeiliModule } from './common/meili/meili.module';
import { TranscodeConsumer } from './consumers/transcode.consumer';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    VideosModule,
    UploadsModule,
    S3Module,
    RedisModule,
    RabbitMQModule,
    MeiliModule,
    SearchModule,
  ],
  providers: [TranscodeConsumer],
})
export class AppModule {}