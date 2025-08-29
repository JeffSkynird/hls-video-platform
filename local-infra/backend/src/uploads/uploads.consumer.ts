import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitMQService } from '../common/rabbitmq/rabbitmq.service';

interface MinioObject {
  key: string;
  size?: number;
  contentType?: string;
}
interface MinioRecord {
  eventName: string; // "s3:ObjectCreated:Put" etc.
  s3: { bucket: { name: string }; object: MinioObject };
}
interface MinioEvent { Records: MinioRecord[] }

@Injectable()
export class UploadsConsumer implements OnModuleInit {
  private readonly log = new Logger(UploadsConsumer.name);

  constructor(private prisma: PrismaService, private rabbit: RabbitMQService) {}

  async onModuleInit() {
    const ch = this.rabbit.channel;
    await ch.addSetup(async (channel) => {
      const exchange = process.env.AMQP_EXCHANGE || 'amq.direct';
      const routingKey = process.env.AMQP_ROUTING_KEY || 'minio.uploads';
      const queue = 'minio.uploads';

      await channel.assertExchange(exchange, 'direct', { durable: true });
      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, exchange, routingKey);
      await channel.prefetch(5);

      await channel.consume(queue, async (msg) => {
        if (!msg) return;
        try {
          const content = msg.content.toString('utf8');
          const parsed: MinioEvent = JSON.parse(content);
          for (const rec of parsed.Records || []) {
            if (!rec?.s3?.object?.key) continue;
            const inputKey = decodeURIComponent(rec.s3.object.key);

            // Extract key videoId (support "<videoId>/..." o "uploads/<videoId>/...")
            const segs = inputKey.replace(/^\/+/, '').split('/');
            const videoId = segs[0] === 'uploads' ? segs[1] : segs[0];
            if (!videoId) continue;

            const video = await this.prisma.video.update({
              where: { id: videoId },
              data: { status: 'uploaded', inputKey },
              select: { id: true, ownerId: true },
            }).catch(() => null);

            if (!video) {
              this.log.warn(`Video not found with key=${inputKey}`);
              continue;
            }

            // Publica evento de dominio para el transcoder
            const domain = {
              type: 'video.uploaded',
              videoId: video.id,
              ownerId: video.ownerId,
              inputKey,
              ts: new Date().toISOString(),
            };
            await channel.publish(
              exchange,
              'video.uploaded',
              Buffer.from(JSON.stringify(domain)),
              { persistent: true },
            );
            this.log.log(`video.uploaded → ${video.id}`);
          }
          channel.ack(msg);
        } catch (e) {
          this.log.error('Error proccesing message', e as Error);
          channel.nack(msg, false, false); // discart (or redirect to DLQ if configured)
        }
      });
    });
  }
}