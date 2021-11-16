import { applyMigrations, init, loadMigrations } from "./cli.ts";
import { Migrate } from "./migrate.ts";

export async function apply(migrate: Migrate): Promise<void> {
  console.log("Connecting to database");
  try {
    await migrate.connect();
  } catch (error) {
    console.log("Failed to connect to database");
    throw error;
  }

  console.log("Acquiring migrate lock");
  const lock = await migrate.lock();
  console.log("Acquired migrate lock");

  await init(migrate);
  const migrations = await loadMigrations(migrate);
  await applyMigrations(migrate, migrations);

  console.log("Releasing migrate lock");
  await lock.release();
  console.log("Released migrate lock");

  console.log("Done");
  await migrate.end();
}
