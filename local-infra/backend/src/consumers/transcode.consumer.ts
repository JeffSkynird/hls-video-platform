import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitMQService } from '../common/rabbitmq/rabbitmq.service';
import { MeiliService } from '../common/meili/meili.service';

@Injectable()
export class TranscodeConsumer implements OnModuleInit {
  private readonly log = new Logger(TranscodeConsumer.name);

  constructor(
    private prisma: PrismaService,
    private mq: RabbitMQService,
    private meili: MeiliService,
  ) {}

  async onModuleInit() {
    const exchange = process.env.RABBITMQ_EXCHANGE || 'app.events';
    const routingKey = process.env.RABBITMQ_ROUTING_READY || 'video.ready';
    const queue = process.env.RABBITMQ_QUEUE_READY || 'backend.video.ready';

    await this.mq.subscribe({
      exchange,
      routingKey,
      queue,
      exchangeType: (process.env.RABBITMQ_EXCHANGE_TYPE as any) || 'direct',
      onMessage: async (evt, ack, retry) => {
        try {
          const { videoId, outputPrefix, thumbKey, duration } = evt;
          if (!videoId || !outputPrefix) {
            this.log.warn(`Evento inválido: ${JSON.stringify(evt)}`);
            return retry();
          }

          await this.prisma.video.update({
            where: { id: videoId },
            data: {
              status: 'ready',
              outputPrefix,
              thumbKey: thumbKey ?? null,
              duration: typeof duration === 'number' ? duration : null,
            },
          });

          const video = await this.prisma.video.findUnique({ where: { id: videoId } });
          if (video) {
            const idx = await this.meili.ensureVideosIndex();
            await idx.addDocuments([{
              id: video.id,
              title: video.title,
              tags: video.tags,
              ownerId: video.ownerId,
              createdAt: video.createdAt.toISOString(),
              visibility: video.visibility,
              status: video.status,
            }]);
          }

          this.log.log(`video.ready indexado y actualizado: ${videoId}`);
          ack();
        } catch (e: any) {
          this.log.error(e?.message || e);
          retry();
        }
      },
    });
  }
}
