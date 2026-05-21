import './config/load-env';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { LoggingInterceptor } from './logging.interceptor';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { join } from 'path';
import { mkdirSync } from 'fs';
import express from 'express';
import { AppModule } from './app.module';

function buildCorsOptions(): CorsOptions {
  const raw = process.env.CORS_ORIGINS?.trim();
  const defaultOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:4200',
  ];

  const origin = raw
    ? raw
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : defaultOrigins;

  return {
    origin,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: process.env.CORS_CREDENTIALS === 'true',
  };
}

async function createHttpApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);

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
