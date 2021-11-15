import { dirname, fromFileUrl, resolve } from "./deps.ts";
import { PostgresMigrate, PostgresMigrateOptions } from "./postgres.ts";

export async function cleanupInit(migrate: PostgresMigrate) {
  await migrate.connect();
  try {
    const transaction = migrate.client.createTransaction(
      "postgres_test_cleanup_init",
    );
    await transaction.begin();
    await transaction.queryArray("DROP TABLE migration");
    await transaction.queryArray("DROP FUNCTION trigger_migration_timestamp");
    await transaction.commit();
  } catch {
    await migrate.connect();
  }
}

export interface MigrateTest {
  migrate?: PostgresMigrate;
}

export interface InitializedMigrateTest extends MigrateTest {
  migrate: PostgresMigrate;
}

const isTestBuild = Deno.env.get("MIGRATE_TEST_BUILD") === "true";
export const options: PostgresMigrateOptions = {
  client: {
    hostname: isTestBuild ? "postgres" : "localhost",
    port: isTestBuild ? 5432 : 6001,
    database: "postgres",
    user: "postgres",
    password: "postgres",
  },
};

export const exampleMigrationsDir = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "examples/postgres/migrations",
);
