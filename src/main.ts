import './config/load-env';

import type { INestApplication } from '@nestjs/common';
import type { Handler } from 'aws-lambda';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
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

/** Один Express-стек для Lambda (API Gateway) і для default (req/res), напр. Vercel / адаптери */
let expressSingleton: ExpressApplication | null = null;

async function getInitializedExpress(): Promise<ExpressApplication> {
  if (!expressSingleton) {
    const app = await createHttpApplication();
    await app.init();
    expressSingleton = app.getHttpAdapter().getInstance() as ExpressApplication;
  }
  return expressSingleton;
}

let lambdaProxy:
  | ((event: unknown, context: unknown) => Promise<unknown>)
  | null = null;

async function getLambdaProxy(): Promise<
  (event: unknown, context: unknown) => Promise<unknown>
> {
  if (!lambdaProxy) {
    lambdaProxy = serverlessHttp(await getInitializedExpress());
  }
  return lambdaProxy;
}

/** AWS Lambda (handler = file.handler) */
export const handler: Handler = async (event, context) => {
  const proxy = await getLambdaProxy();
  return proxy(event, context) as Promise<object>;
};

/**
 * Платформи з перевіркою default export (Vercel, частина адаптерів):
 * має бути функція (req, res) або http.Server.
 */
export default async function defaultHttpHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const expressApp = await getInitializedExpress();
  expressApp(req, res);
}

const isDirectNodeEntry =
  typeof require !== 'undefined' && require.main === module;

if (isDirectNodeEntry) {
  void bootstrapHttpServer();
}
