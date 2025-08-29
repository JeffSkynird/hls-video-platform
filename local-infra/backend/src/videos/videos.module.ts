import { Module } from '@nestjs/common';
import { VideosController } from './videos.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({ imports: [PrismaModule], controllers: [VideosController] })
export class VideosModule {}