import { INestApplication, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }

  // Prisma v5 removed prisma.$on('beforeExit'). Hook into Node's process instead.
  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => { await app.close(); });
  }

  async onModuleDestroy() { await this.$disconnect(); }
}
