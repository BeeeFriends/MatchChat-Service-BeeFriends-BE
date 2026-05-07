import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const databaseUrl =
  process.env.MATCH_CHAT_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});
