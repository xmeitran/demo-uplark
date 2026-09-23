import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: '../../../prisma/schema.prisma',
  migrations: { path: '../../../prisma/migrations', seed: 'echo fixture-only' },
});
