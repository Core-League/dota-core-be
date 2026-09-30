import '../../../config/load-env';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { LoggingInterceptor } from '../../../logging.interceptor';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { join } from 'path';
import { mkdirSync } from 'fs';
import express from 'express';
import { AppModule } from '../../../app.module';
import { buildCorsOptions } from '../../../config/cors';

async function createHttpApplication(): Promise<INestApplication> {
  // rawBody is required by the Monobank acquiring callback: its signature is
  // taken over the exact bytes received, which the JSON parser otherwise discards.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors(buildCorsOptions());

  app.useGlobalInterceptors(new LoggingInterceptor());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const uploadsDir = join(process.cwd(), 'uploads');
  mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));

  const config = new DocumentBuilder()
    .setTitle('Core Backend API')
    .setDescription('REST API for the core backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  return app;
}

/** PM2, Docker, локально: довгоживучий HTTP-сервер */
async function bootstrapHttpServer(): Promise<void> {
  const app = await createHttpApplication();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

const isDirectNodeEntry =
  typeof require !== 'undefined' && require.main === module;

if (isDirectNodeEntry) {
  void bootstrapHttpServer();
}
