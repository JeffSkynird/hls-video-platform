import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { PublishDto } from './dto/publish.dto';
import { MeiliService } from '../common/meili/meili.service';

function playbackUrl(outputPrefix: string | null | undefined) {
  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:8080';
  // Suponemos prefijo determinista: vod/hls/{videoId}/
  if (!outputPrefix) return null;
  const parts = outputPrefix.split('/');
  const vid = parts.find((p) => p && p.length >= 8); // heurística mínima
  return `${base}/hls/${vid}/master.m3u8`;
}

@Controller('videos')
export class VideosController {
  constructor(private prisma: PrismaService, private meili: MeiliService) {}

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
    const v = await this.prisma.video.findUnique({ where: { id } });
    return v ? { ...v, hlsUrl: playbackUrl(v.outputPrefix) } : { error: 'not_found' };
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @Body() body: PublishDto) {
    const v = await this.prisma.video.update({
      where: { id },
      data: { visibility: body.visibility },
      select: {
        id: true,
        title: true,
        tags: true,
        ownerId: true,
        createdAt: true,
        visibility: true,
        status: true,
      },
    });

    // Upsert in Meili to reflect new visibility
    try {
      const idx = await this.meili.ensureVideosIndex();
      await idx.addDocuments([
        {
          id: v.id,
          title: v.title,
          tags: v.tags,
          ownerId: v.ownerId,
          createdAt: v.createdAt.toISOString(),
          visibility: v.visibility,
          status: v.status,
        },
      ]);
    } catch (_) {
      // swallow indexing errors to not block publish
    }

    return { id: v.id, visibility: v.visibility };
  }

  @Get()
  async list(
    @Query('status') status = 'ready',
    @Query('visibility') visibility: 'public' | 'private' = 'public',
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(parseInt(page, 10) || 1, 1);
    const ps = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);

    const where: any = {};
    if (status) where.status = status;
    if (visibility) where.visibility = visibility;

    const [items, total] = await Promise.all([
      this.prisma.video.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
      }),
      this.prisma.video.count({ where }),
    ]);

    return {
      page: p,
      pageSize: ps,
      total,
      items: items.map((v) => ({
        id: v.id,
        title: v.title,
        tags: v.tags,
        thumbKey: v.thumbKey,
        status: v.status,
        visibility: v.visibility,
        createdAt: v.createdAt,
        hlsUrl: playbackUrl(v.outputPrefix),
      })),
    };
  }
}
