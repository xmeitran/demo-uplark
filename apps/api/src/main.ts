import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureAppSecurity } from './bootstrap-security';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Direct uploads send base64 JSON, which is roughly 33% larger than the file.
  // Keep this above the service's 10 MB binary upload limit so valid uploads are
  // not rejected by Express before ArtifactsService can validate them.
  // Nest's Express adapter exposes this at runtime, but the generic
  // INestApplication type does not declare the adapter-specific helper.
  (app as typeof app & { useBodyParser: (type: string, options: { limit: string }) => void }).useBodyParser("json", {
    limit: process.env.CRM_JSON_BODY_LIMIT ?? "15mb"
  });
  app.setGlobalPrefix('api');
  configureAppSecurity(app);

  const port = process.env.API_PORT || 4000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/api`);
}
bootstrap();
