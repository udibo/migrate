import { delay, resolve } from "./deps.ts";
import { PostgresMigrate } from "./postgres.ts";
import { assertEquals, test, TestSuite } from "./test_deps.ts";
import {
  cleanupInit,
  exampleMigrationsDir,
  InitializedMigrateTest,
  options,
} from "./test_postgres.ts";
import "./basic.ts";

const applyTests = new TestSuite({
  name: "apply",
  async beforeEach(context: InitializedMigrateTest) {
    context.migrate = new PostgresMigrate({
      ...options,
      migrationsDir: exampleMigrationsDir,
    });
    const { migrate } = context;
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
  async afterEach({ migrate }: InitializedMigrateTest) {
    await migrate.end();
  },
});

test(
  applyTests,
  "creates migration table and applies all migrations",
  async ({ migrate }) => {
    const process = Deno.run({
      cmd: [
        resolve(migrate.migrationsDir, "../migrate_basic.ts"),
      ],
      stdout: "piped",
    });
    try {
      const output = await process.output();
      const decoder = new TextDecoder();
      assertEquals(
        decoder.decode(output),
        `\
Connecting to database
Acquiring migrate lock
Acquired migrate lock
Creating migration table if it does not exist
Created migration table
Loading migrations
2 new migrations found
2 unapplied migrations
Applying migration: 0_user_create.sql
Applying migration: 1_user_add_column_email.sql
Finished applying all migrations
Releasing migrate lock
Released migrate lock
Done
`,
      );
    } finally {
      process.close();
    }
  },
);

test(applyTests, "applies unapplied migrations", async ({ migrate }) => {
  await migrate.connect();
  await migrate.init();
  await migrate.load();
  const migrations = await migrate.getUnapplied();
  await migrate.apply(migrations[0]);
  await migrate.end();
  await delay(1);

  const process = Deno.run({
    cmd: [
      resolve(migrate.migrationsDir, "../migrate_basic.ts"),
    ],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
Connecting to database
Acquiring migrate lock
Acquired migrate lock
Creating migration table if it does not exist
Migration table already exists
Loading migrations
No new migrations found
No migrations updated
No migrations deleted
1 unapplied migration
Applying migration: 1_user_add_column_email.sql
Finished applying all migrations
Releasing migrate lock
Released migrate lock
Done
`,
    );
  } finally {
    process.close();
  }
});

test(applyTests, "no unapplied migrations", async ({ migrate }) => {
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
    cmd: [
      resolve(migrate.migrationsDir, "../migrate_basic.ts"),
    ],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
Connecting to database
Acquiring migrate lock
Acquired migrate lock
Creating migration table if it does not exist
Migration table already exists
Loading migrations
No new migrations found
No migrations updated
No migrations deleted
No unapplied migrations
Releasing migrate lock
Released migrate lock
Done
`,
    );
  } finally {
    process.close();
  }
});
