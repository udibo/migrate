import { delay, resolve } from "./deps.ts";
import { PostgresMigrate } from "./postgres.ts";
import { assertEquals, describe, it, spy } from "./test_deps.ts";

import {
  cleanupInit,
  exampleMigrationsDir,
  InitializedMigrateTest,
  options,
} from "./test_postgres.ts";
import "./cli.ts";

const cliTests = describe<InitializedMigrateTest>({
  name: "CLI",
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

const cliInitTests = describe({
  name: "init",
  suite: cliTests,
});

it(
  cliInitTests,
  "creates migration table if it does not exist yet",
  async function () {
    const { migrate } = this;
    const process = Deno.run({
      cmd: [resolve(migrate.migrationsDir, "../migrate.ts"), "init"],
      stdout: "piped",
    });
    try {
      const output = await process.output();
      const decoder = new TextDecoder();
      assertEquals(
        decoder.decode(output),
        `\
[INFO]: Connecting to database
[INIT]: Initializing migrate...
[INIT]: Database has been initialised with migrations table and migration timestamp trigger.
[INIT]: To get started, create your first migration using the filename format of 0_migration_title.{sql,json} and run \`apply\`
`,
      );
    } finally {
      process.close();
    }
  },
);

it(cliInitTests, "migration table already exists", async function () {
  const { migrate } = this;
  await migrate.connect();
  await migrate.init();
  await migrate.end();

  const process = Deno.run({
    cmd: [resolve(migrate.migrationsDir, "../migrate.ts"), "init"],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
[INFO]: Connecting to database
[INIT]: Initializing migrate...
[ERROR]: Migration table already exists. Have you already initialized migrate?
`,
    );
  } finally {
    process.close();
  }
});

const cliLoadTests = describe({
  name: "load",
  suite: cliTests,
  async beforeEach() {
    const { migrate } = this;
    await migrate.connect();
    await migrate.init();
    await migrate.end();
  },
});

it(cliLoadTests, "new migrations only", async function () {
  const { migrate } = this;
  const process = Deno.run({
    cmd: [resolve(migrate.migrationsDir, "../migrate.ts"), "load"],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
[INFO]: Connecting to database
[LOAD]: Acquiring migrate lock
[LOAD]: Acquired migrate lock
[LOAD]: 2 new migrations found
[LOAD]: Releasing migrate lock
[LOAD]: Released migrate lock
[LOAD]: Load has completed. New migrations are now in the database. To apply them, please run apply.
`,
    );
  } finally {
    process.close();
  }
});

it(cliLoadTests, "moved migration", async function () {
  const { migrate } = this;
  await migrate.connect();
  await migrate.load();
  await migrate
    .client
    .queryArray`UPDATE migration SET path = ${"1_old_name.sql"}, applied_at = now() WHERE id = ${1}`;
  const migrations = await migrate.getUnapplied();
  await migrate.apply(migrations[0]);
  await migrate.end();
  await delay(1);

  const process = Deno.run({
    cmd: [resolve(migrate.migrationsDir, "../migrate.ts"), "load"],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
[INFO]: Connecting to database
[LOAD]: Acquiring migrate lock
[LOAD]: Acquired migrate lock
[LOAD]: No new migrations found
[LOAD]: 1 migration updated
[LOAD]: No migrations deleted
[LOAD]: Releasing migrate lock
[LOAD]: Released migrate lock
[LOAD]: Load has completed. New migrations are now in the database. To apply them, please run apply.
`,
    );
  } finally {
    process.close();
  }
});

it(cliLoadTests, "deleted migration", async function () {
  const { migrate } = this;
  await migrate.connect();
  await migrate.load();
  await migrate.client.queryArray`
      INSERT INTO migration (id, path, applied_path, applied_at) VALUES
        (2, '2_user_add_admin.sql', NULL, NULL);
    `;
  const migrations = await migrate.getUnapplied();
  await migrate.apply(migrations[0]);
  await migrate.end();
  await delay(1);

  const process = Deno.run({
    cmd: [resolve(migrate.migrationsDir, "../migrate.ts"), "load"],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
[INFO]: Connecting to database
[LOAD]: Acquiring migrate lock
[LOAD]: Acquired migrate lock
[LOAD]: No new migrations found
[LOAD]: No migrations updated
[LOAD]: 1 migration deleted
[LOAD]: Releasing migrate lock
[LOAD]: Released migrate lock
[LOAD]: Load has completed. New migrations are now in the database. To apply them, please run apply.
`,
    );
  } finally {
    process.close();
  }
});

const cliStatusTests = describe({
  name: "status",
  suite: cliTests,
  async beforeEach() {
    const { migrate } = this;
    await migrate.connect();
    await migrate.init();
    await migrate.client.queryArray`
      INSERT INTO migration (id, path, applied_path, applied_at) VALUES
        (0, '0_user_create.sql', '0_user_create.sql', NOW()),
        (1, '1_user_add_admin.sql', '1_user_add_admin.sql', NOW()),
        (2, '2_user_add_kyle.ts', '2_user_add_kyle.sql', NOW()),
        (3, NULL, '3_user_add_staff.sql', NOW()),
        (4, '4_user_add_column_email.sql', NULL, NULL);
    `;
    await migrate.end();
  },
});

it(cliStatusTests, "without details", async function () {
  const { migrate } = this;
  const process = Deno.run({
    cmd: [resolve(migrate.migrationsDir, "../migrate.ts"), "status"],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
[INFO]: Connecting to database
[STATUS]: Checking loaded migrations
[STATUS]:   Total: 5
[STATUS]:   Applied: 4
[STATUS]:   File moved: 1
[STATUS]:   File deleted: 1
[STATUS]:   Not applied: 1
`,
    );
  } finally {
    process.close();
  }
});

it(cliStatusTests, "with details", async function () {
  const { migrate } = this;
  const process = Deno.run({
    cmd: [
      resolve(migrate.migrationsDir, "../migrate.ts"),
      "status",
      "--details",
    ],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
[INFO]: Connecting to database
[STATUS]: Checking loaded migrations
[STATUS]:   Total: 5
[STATUS]:   Applied: 4
[STATUS]:   File moved: 1
[STATUS]:     2_user_add_kyle.sql -> 2_user_add_kyle.ts
[STATUS]:   File deleted: 1
[STATUS]:     3_user_add_staff.sql
[STATUS]:   Not applied: 1
[STATUS]:     4_user_add_column_email.sql
`,
    );
  } finally {
    process.close();
  }
});

const cliListTests = describe({
  name: "list",
  suite: cliTests,
  async beforeEach() {
    const { migrate } = this;
    await migrate.connect();
    await migrate.init();
    await migrate.client.queryArray`
      INSERT INTO migration (id, path, applied_path, applied_at) VALUES
        (0, '0_user_create.sql', '0_user_create.sql', NOW()),
        (1, '1_user_add_admin.sql', '1_user_add_admin.sql', NOW()),
        (2, '2_user_add_kyle.ts', '2_user_add_kyle.sql', NOW()),
        (3, NULL, '3_user_add_staff.sql', NOW()),
        (4, '4_user_add_column_email.sql', NULL, NULL);
    `;
    await migrate.end();
  },
});

function decodeListOutput(output: Uint8Array): string {
  const decoder = new TextDecoder();
  return decoder
    .decode(output)
    .replace(/applied at: [^\n]*\n/g, "applied at: {DATE}\n");
}

it(cliListTests, "all migrations", async function () {
  const { migrate } = this;
  const process = Deno.run({
    cmd: [resolve(migrate.migrationsDir, "../migrate.ts"), "list"],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    assertEquals(
      decodeListOutput(output),
      `\
[INFO]: Connecting to database
[LIST]: Checking loaded migrations
[LIST]: All migrations:
[LIST]:   0_user_create.sql
[LIST]:     applied at: {DATE}
[LIST]:   1_user_add_admin.sql
[LIST]:     applied at: {DATE}
[LIST]:   2_user_add_kyle.sql
[LIST]:     applied at: {DATE}
[LIST]:     file moved to: 2_user_add_kyle.ts
[LIST]:   3_user_add_staff.sql
[LIST]:     applied at: {DATE}
[LIST]:     file deleted
[LIST]:   4_user_add_column_email.sql
[LIST]:     not applied
`,
    );
  } finally {
    process.close();
  }
});

it(cliListTests, "applied migrations", async function () {
  const { migrate } = this;
  const process = Deno.run({
    cmd: [
      resolve(migrate.migrationsDir, "../migrate.ts"),
      "list",
      "--filter=applied",
    ],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    assertEquals(
      decodeListOutput(output),
      `\
[INFO]: Connecting to database
[LIST]: Checking loaded migrations
[LIST]: Applied migrations:
[LIST]:   0_user_create.sql
[LIST]:     applied at: {DATE}
[LIST]:   1_user_add_admin.sql
[LIST]:     applied at: {DATE}
[LIST]:   2_user_add_kyle.sql
[LIST]:     applied at: {DATE}
[LIST]:     file moved to: 2_user_add_kyle.ts
[LIST]:   3_user_add_staff.sql
[LIST]:     applied at: {DATE}
[LIST]:     file deleted
`,
    );
  } finally {
    process.close();
  }
});

it(cliListTests, "unapplied migrations", async function () {
  const { migrate } = this;
  const process = Deno.run({
    cmd: [
      resolve(migrate.migrationsDir, "../migrate.ts"),
      "list",
      "--filter=unapplied",
    ],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    assertEquals(
      decodeListOutput(output),
      `\
[INFO]: Connecting to database
[LIST]: Checking loaded migrations
[LIST]: Unapplied migrations:
[LIST]:   4_user_add_column_email.sql
`,
    );
  } finally {
    process.close();
  }
});

it(cliListTests, "moved migrations", async function () {
  const { migrate } = this;
  const process = Deno.run({
    cmd: [
      resolve(migrate.migrationsDir, "../migrate.ts"),
      "list",
      "--filter=moved",
    ],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    assertEquals(
      decodeListOutput(output),
      `\
[INFO]: Connecting to database
[LIST]: Checking loaded migrations
[LIST]: Moved migrations:
[LIST]:   2_user_add_kyle.sql
[LIST]:     applied at: {DATE}
[LIST]:     file moved to: 2_user_add_kyle.ts
`,
    );
  } finally {
    process.close();
  }
});

it(cliListTests, "deleted migrations", async function () {
  const { migrate } = this;
  const process = Deno.run({
    cmd: [
      resolve(migrate.migrationsDir, "../migrate.ts"),
      "list",
      "--filter=deleted",
    ],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    assertEquals(
      decodeListOutput(output),
      `\
[INFO]: Connecting to database
[LIST]: Checking loaded migrations
[LIST]: Deleted migrations:
[LIST]:   3_user_add_staff.sql
[LIST]:     applied at: {DATE}
`,
    );
  } finally {
    process.close();
  }
});

const cliApplyTests = describe({
  name: "apply",
  suite: cliTests,
  async beforeEach() {
    const { migrate } = this;
    await migrate.connect();
    await migrate.init();
    await migrate.load();
    await migrate.end();
  },
});

it(cliApplyTests, "all unapplied", async function () {
  const { migrate } = this;
  const process = Deno.run({
    cmd: [resolve(migrate.migrationsDir, "../migrate.ts"), "apply"],
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
[APPLY]: Checking loaded migrations
[APPLY]: 2 unapplied migrations
[APPLY]: Applying migration: 0_user_create.sql
[APPLY]: Applying migration: 1_user_add_column_email.sql
[APPLY]: Finished applying all migrations
[APPLY]: Releasing migrate lock
[APPLY]: Released migrate lock
[APPLY]: Migrations applied successfully
`,
    );
  } finally {
    process.close();
  }
});

it(cliApplyTests, "no unapplied", async function () {
  const { migrate } = this;
  await migrate.connect();
  const migrations = await migrate.getUnapplied();
  for (const migration of migrations) {
    await migrate.apply(migration);
  }
  await migrate.end();

  const process = Deno.run({
    cmd: [resolve(migrate.migrationsDir, "../migrate.ts"), "apply"],
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
[APPLY]: Checking loaded migrations
[APPLY]: No unapplied migrations
[APPLY]: Releasing migrate lock
[APPLY]: Released migrate lock
[APPLY]: Migrations applied successfully
`,
    );
  } finally {
    process.close();
  }
});

const cliNoCommandTests = describe({
  name: "invalid command",
  suite: cliTests,
  async beforeEach() {
    const { migrate } = this;
    await migrate.connect();
    await migrate.init();
    await migrate.load();
    await migrate.end();
  },
});

it(cliNoCommandTests, "no command supplied", async function () {
  const { migrate } = this;
  await migrate.connect();
  const migrations = await migrate.getUnapplied();
  for (const migration of migrations) {
    await migrate.apply(migration);
  }
  await migrate.end();

  const process = Deno.run({
    cmd: [resolve(migrate.migrationsDir, "../migrate.ts"), ""],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
[ERROR]: Command not found or missing argument.
`,
    );
  } finally {
    process.close();
  }
});

it(cliNoCommandTests, "help flag supplied", async function () {
  const { migrate } = this;
  await migrate.connect();
  const migrations = await migrate.getUnapplied();
  for (const migration of migrations) {
    await migrate.apply(migration);
  }
  await migrate.end();

  const process = Deno.run({
    cmd: [resolve(migrate.migrationsDir, "../migrate.ts"), "--help"],
    stdout: "piped",
  });
  try {
    const output = await process.output();
    const decoder = new TextDecoder();
    assertEquals(
      decoder.decode(output),
      `\
[INFO]: Migrate allows you to manage your postgres migrations via the CLI and files in your codebase
[INIT]: init allows you to initialize your project and creates a migrations table in your database.
[LOAD]: load allows you to add migrations to your database but not run them
[APPLY]: apply loads and migrates any unmigrated migrations
[LIST]: list shows you all your migration files and their status
[STATUS]: status gives you an overview of your migrations
`,
    );
  } finally {
    process.close();
  }
});
