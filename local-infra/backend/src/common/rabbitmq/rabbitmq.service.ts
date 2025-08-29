import { Injectable, OnModuleDestroy } from '@nestjs/common';
import amqp, { ChannelWrapper, AmqpConnectionManager } from 'amqp-connection-manager';

@Injectable()
export class RabbitMQService implements OnModuleDestroy {
  private connection: AmqpConnectionManager;
  channel: ChannelWrapper;

  constructor() {
    const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672/';
    this.connection = amqp.connect([url]);
    this.channel = this.connection.createChannel({ json: true });
  }

  async onModuleDestroy() {
    await this.channel.close();
    await this.connection.close();
  }
}