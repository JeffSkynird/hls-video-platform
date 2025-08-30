import { Injectable, OnModuleDestroy } from '@nestjs/common';
import amqp, { ChannelWrapper, AmqpConnectionManager } from 'amqp-connection-manager';
import { ConfirmChannel, Options } from 'amqplib';

@Injectable()
export class RabbitMQService implements OnModuleDestroy {
  private connection: AmqpConnectionManager;
  channel: ChannelWrapper;

  constructor() {
    const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672/';
    this.connection = amqp.connect([url]);
    this.channel = this.connection.createChannel({ json: true });
  }

  async subscribe(params: {
    exchange: string;
    routingKey: string;
    queue: string;
    exchangeType?: 'direct' | 'topic' | 'fanout' | 'headers';
    onMessage: (
      msg: any,
      ack: () => void,
      retry: () => void,
    ) => Promise<void> | void;
  }) {
    await this.channel.addSetup(async (ch: ConfirmChannel) => {
      const type: Options.AssertExchange['type'] =
        params.exchangeType || (process.env.RABBITMQ_EXCHANGE_TYPE as any) || 'direct';
      await ch.assertExchange(params.exchange, type, { durable: true });
      await ch.assertQueue(params.queue, { durable: true });
      await ch.bindQueue(params.queue, params.exchange, params.routingKey);
      await ch.consume(params.queue, async (msg) => {
        if (!msg) return;
        const ack = () => ch.ack(msg);
        const retry = () => ch.nack(msg, false, true);
        try {
          const payload = JSON.parse(msg.content.toString());
          await params.onMessage(payload, ack, retry);
        } catch (e) {
          retry();
        }
      }, { noAck: false });
    });
  }

  async onModuleDestroy() {
    await this.channel.close();
    await this.connection.close();
  }
}
