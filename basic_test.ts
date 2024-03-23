import { delay, resolve } from "./deps.ts";
import { PostgresMigrate } from "./postgres.ts";
import { assertEquals, describe, it } from "./test_deps.ts";
import {
  cleanupInit,
  exampleMigrationsDir,
  InitializedMigrateTest,
  options,
} from "./test_postgres.ts";
import "./basic.ts";

const applyTests = describe<InitializedMigrateTest>({
  name: "apply",
  async beforeEach() {
    this.migrate = new PostgresMigrate({
      ...options,
      migrationsDir: exampleMigrationsDir,
    });
    const { migrate } = this;
    await cleanupInit(migrate);
    try {
      await migrate.connect();
      await migrate.client.queryArray(`DROP TABLE "user"`);
    } catch {
      // user table did not exist
    } finally {
      await migrate.end();
    }
  },
  async afterEach() {
    await this.migrate.end();
  },
});

it(
  applyTests,
  "creates migration table and applies all migrations",
  async function () {
    const { migrate } = this;
    const process = Deno.run({
      cmd: [resolve(migrate.migrationsDir, "../migrate_basic.ts")],
      stdout: "piped",
    });
    try {
      const output = await process.output();
      const decoder = new TextDecoder();
      assertEquals(
        decoder.decode(output),
        `\
[INFO]: Connecting to database
[APPLY]: Acquiring migrate lock
[APPLY]: Acquired migrate lock
[INIT]: Initializing migrate...
[INIT]: Database has been initialised with migrations table and migration timestamp trigger.
[INIT]: To get started, create your first migration using the filename format of 0_migration_title.{sql,json} and run \`apply\`
[LOAD]: 2 new migrations found
[APPLY]: 2 unapplied migrations
[APPLY]: Applying migration: 0_user_create.sql
[APPLY]: Applying migration: 1_user_add_column_email.sql
[APPLY]: Finished applying all migrations
[APPLY]: Releasing migrate lock
[APPLY]: Released migrate lock
`,
      );
    } finally {
      process.close();
    }
  },
);

it(applyTests, "applies unapplied migrations", async function () {
  const { migrate } = this;
  await migrate.connect();
  await migrate.init();
  await migrate.load();
  const migrations = await migrate.getUnapplied();
  await migrate.apply(migrations[0]);
  await migrate.end();
  await delay(1);

  const process = Deno.run({
    cmd: [resolve(migrate.migrationsDir, "../migrate_basic.ts")],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
[INFO]: Connecting to database
[APPLY]: Acquiring migrate lock
[APPLY]: Acquired migrate lock
[INIT]: Initializing migrate...
[ERROR]: Migration table already exists. Have you already initialized migrate?
[LOAD]: No new migrations found
[LOAD]: No migrations updated
[LOAD]: No migrations deleted
[APPLY]: 1 unapplied migration
[APPLY]: Applying migration: 1_user_add_column_email.sql
[APPLY]: Finished applying all migrations
[APPLY]: Releasing migrate lock
[APPLY]: Released migrate lock
`,
    );
  } finally {
    process.close();
  }
});

it(applyTests, "no unapplied migrations", async function () {
  const { migrate } = this;
  await migrate.connect();
  await migrate.init();
  await migrate.load();
  const migrations = await migrate.getUnapplied();
  for (const migration of migrations) {
    await migrate.apply(migration);
  }
  await migrate.end();
  await delay(1);

  const process = Deno.run({
    cmd: [resolve(migrate.migrationsDir, "../migrate_basic.ts")],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
[INFO]: Connecting to database
[APPLY]: Acquiring migrate lock
[APPLY]: Acquired migrate lock
[INIT]: Initializing migrate...
[ERROR]: Migration table already exists. Have you already initialized migrate?
[LOAD]: No new migrations found
[LOAD]: No migrations updated
[LOAD]: No migrations deleted
[APPLY]: No unapplied migrations
[APPLY]: Releasing migrate lock
[APPLY]: Released migrate lock
`,
    );
  } finally {
    process.close();
  }
});
