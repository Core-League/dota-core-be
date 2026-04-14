import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors(buildCorsOptions());

  const config = new DocumentBuilder()
    .setTitle('Core Backend API')
    .setDescription('REST API for the core backend')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
