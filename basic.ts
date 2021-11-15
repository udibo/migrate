// add test coverage for it using Deno.run

import { Migrate } from "./migrate.ts";

export async function apply(migrate: Migrate): Promise<void> {
  console.log("Connecting to database");
  try {
    await migrate.connect();
  } catch (error) {
    console.error("Failed to connect to database");
    throw error;
  }

  console.log("Acquiring advisory lock");
  const lock = await migrate.lock();
  console.log("Acquired advisory lock");

  try {
    console.log("Creating migration table if it does not exist");
    await migrate.init();
    console.log("Created migration table");
  } catch {
    console.log("Migration table already exists");
  }

  console.log("Loading migrations");
  await migrate.load();

  console.log("Checking for unapplied migrations");
  const migrations = await migrate.getUnapplied();
  const migrationTerm = `migration${migrations.length !== 1 ? "s" : ""}`;
  console.log(
    `${migrations.length || "No"} unapplied ${migrationTerm} found`,
  );
  if (migrations.length) {
    for (const migration of migrations) {
      console.log(`Applying migration: ${migration.path}`);
      await migrate.apply(migration);
    }
    console.log("Finished applying all migrations");
  }

  console.log("Releasing advisory lock");
  await lock.release();
  console.log("Released advisory lock");
  await migrate.end();
  console.log("Done");
}
