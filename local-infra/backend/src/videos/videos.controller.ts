import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';

@Controller('videos')
export class VideosController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@Body() dto: CreateVideoDto) {
    const owner = await this.prisma.user.findFirst();
    const ownerId = owner?.id || (await this.prisma.user.create({ data: { email: 'demo@example.com' } })).id;
    const video = await this.prisma.video.create({
      data: {
        ownerId,
        title: dto.title,
        tags: dto.tags ?? [],
        status: 'pending',
      },
      select: { id: true, status: true, title: true, tags: true },
    });
    return video;
  }

  @Get(':id')
  async byId(@Param('id') id: string) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    return video ?? { error: 'not_found' };
  }
}