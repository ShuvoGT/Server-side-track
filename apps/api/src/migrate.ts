import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));

/**
 * Applies pending Prisma migrations to the SQLite file. The API is the only writer, so it migrates its own
 * database at startup instead of needing a separate job.
 */
export async function migrateDatabase(databaseUrl: string): Promise<void> {
  if (databaseUrl.startsWith('file:')) {
    // Prisma resolves relative SQLite paths from the schema's folder; make sure the directory exists.
    const file = databaseUrl.slice('file:'.length).split('?')[0]!;
    mkdirSync(dirname(resolve(dirname(schemaPath), file)), { recursive: true });
  }
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  await new Promise<void>((done, fail) => {
    const child = spawn(process.execPath, [cli, 'migrate', 'deploy', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`prisma migrate deploy exited with ${code}`)),
    );
  });
}
