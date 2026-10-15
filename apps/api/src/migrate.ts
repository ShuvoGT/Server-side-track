import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const schemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));

/**
 * Applies pending Prisma migrations. The API owns its database, so it migrates it at startup instead of needing a
 * separate job; `migrate deploy` takes an advisory lock, so replicas starting together are safe.
 */
export async function migrateDatabase(databaseUrl: string): Promise<void> {
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
