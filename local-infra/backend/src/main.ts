import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  app.setGlobalPrefix('v1');
  app.enableCors({ origin: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');
}

bootstrap();