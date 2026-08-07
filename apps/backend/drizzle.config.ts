import { defineConfig } from 'drizzle-kit';

/** I percorsi sono relativi alla root del repository (`npm run db:generate`). */
export default defineConfig({
  dialect: 'sqlite',
  schema: './apps/backend/src/modules/**/*.schema.ts',
  out: './apps/backend/drizzle',
  dbCredentials: {
    url: './apps/backend/data/appconto.db',
  },
});
