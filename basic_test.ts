import { resolve } from "./deps.ts";
import { PostgresMigrate } from "./postgres.ts";
import { assertEquals, test, TestSuite } from "./test_deps.ts";
import {
  cleanupInit,
  exampleMigrationsDir,
  InitializedMigrateTest,
  options,
} from "./test_postgres.ts";

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

test(applyTests, "works", async ({ migrate }) => {
  const runMigrateBasic = () =>
    Deno.run({
      cmd: [
        resolve(migrate.migrationsDir, "../migrate_basic.ts"),
      ],
      stdout: "piped",
    });
  let process = runMigrateBasic();
  try {
    let output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
Connecting to database
Acquiring advisory lock
Acquired advisory lock
Creating migration table if it does not exist
Created migration table
Loading migrations
Checking for unapplied migrations
2 unapplied migrations found
Applying migration: 0_user_create.sql
Applying migration: 1_user_add_column_email.sql
Finished applying all migrations
Releasing advisory lock
Released advisory lock
Done
`,
    );
    process.close();

    process = runMigrateBasic();
    output = await process.output();
    assertEquals(
      decoder.decode(output),
      `\
Connecting to database
Acquiring advisory lock
Acquired advisory lock
Creating migration table if it does not exist
Migration table already exists
Loading migrations
Checking for unapplied migrations
No unapplied migrations found
Releasing advisory lock
Released advisory lock
Done
`,
    );
  } finally {
    process.close();
  }
});