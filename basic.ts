import { applyMigrations, init, loadMigrations } from "./cli.ts";
import { logger } from "./lib.ts";
import { Migrate } from "./migrate.ts";

export async function apply(migrate: Migrate): Promise<void> {
  logger("info", "Connecting to database");
  try {
    await migrate.connect();
  } catch (error) {
    logger("error", "Failed to connect to database");
    throw error;
  }

  logger("apply", "Acquiring migrate lock");
  const lock = await migrate.lock();
  logger("apply", "Acquired migrate lock");

  await init(migrate);
  const migrations = await loadMigrations(migrate);
  await applyMigrations(migrate, migrations);

  logger("apply", "Releasing migrate lock");
  await lock.release();
  logger("apply", "Released migrate lock");

  await migrate.end();
}
