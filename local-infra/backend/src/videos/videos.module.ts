import { Module } from '@nestjs/common';
import { VideosController } from './videos.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MeiliModule } from '../common/meili/meili.module';

@Module({ imports: [PrismaModule, MeiliModule], controllers: [VideosController] })
export class VideosModule {}
