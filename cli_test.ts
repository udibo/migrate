import { delay, resolve } from "./deps.ts";
import { PostgresMigrate } from "./postgres.ts";
import { assertEquals, test, TestSuite } from "./test_deps.ts";
import {
  cleanupInit,
  exampleMigrationsDir,
  InitializedMigrateTest,
  options,
} from "./test_postgres.ts";
import "./cli.ts";

const cliTests = new TestSuite({
  name: "CLI",
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

const cliInitTests = new TestSuite({
  name: "init",
  suite: cliTests,
});

test(
  cliInitTests,
  "creates migration table if it does not exist yet",
  async ({ migrate }) => {
    const process = Deno.run({
      cmd: [
        resolve(migrate.migrationsDir, "../migrate.ts"),
        "init",
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
Creating migration table if it does not exist
Created migration table
`,
      );
    } finally {
      process.close();
    }
  },
);

test(
  cliInitTests,
  "migration table already exists",
  async ({ migrate }) => {
    await migrate.connect();
    await migrate.init();
    await migrate.end();

    const process = Deno.run({
      cmd: [
        resolve(migrate.migrationsDir, "../migrate.ts"),
        "init",
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
Creating migration table if it does not exist
Migration table already exists
`,
      );
    } finally {
      process.close();
    }
  },
);

const cliLoadTests = new TestSuite({
  name: "load",
  suite: cliTests,
  async beforeEach({ migrate }: InitializedMigrateTest) {
    await migrate.connect();
    await migrate.init();
    await migrate.end();
  },
});

test(
  cliLoadTests,
  "new migrations only",
  async ({ migrate }) => {
    const process = Deno.run({
      cmd: [
        resolve(migrate.migrationsDir, "../migrate.ts"),
        "load",
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
Loading migrations
2 new migrations found
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

test(
  cliLoadTests,
  "moved migration",
  async ({ migrate }) => {
    await migrate.connect();
    await migrate.load();
    await migrate.client.queryArray
      `UPDATE migration SET path = ${"1_old_name.sql"}, applied_at = now() WHERE id = ${1}`;
    const migrations = await migrate.getUnapplied();
    await migrate.apply(migrations[0]);
    await migrate.end();
    await delay(1);

    const process = Deno.run({
      cmd: [
        resolve(migrate.migrationsDir, "../migrate.ts"),
        "load",
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
Loading migrations
No new migrations found
1 migration updated
No migrations deleted
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

test(
  cliLoadTests,
  "deleted migration",
  async ({ migrate }) => {
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
      cmd: [
        resolve(migrate.migrationsDir, "../migrate.ts"),
        "load",
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
Loading migrations
No new migrations found
No migrations updated
1 migration deleted
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

const cliStatusTests = new TestSuite({
  name: "status",
  suite: cliTests,
  async beforeEach({ migrate }: InitializedMigrateTest) {
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

test(
  cliStatusTests,
  "without details",
  async ({ migrate }) => {
    const process = Deno.run({
      cmd: [
        resolve(migrate.migrationsDir, "../migrate.ts"),
        "status",
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
Checking loaded migrations
Status:
  Total: 5
  Applied: 4
  File moved: 1
  File deleted: 1
  Not applied: 1
`,
      );
    } finally {
      process.close();
    }
  },
);

test(
  cliStatusTests,
  "with details",
  async ({ migrate }) => {
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
Connecting to database
Checking loaded migrations
Status:
  Total: 5
  Applied: 4
  File moved: 1
    2_user_add_kyle.sql -> 2_user_add_kyle.ts
  File deleted: 1
    3_user_add_staff.sql
  Not applied: 1
    4_user_add_column_email.sql
`,
      );
    } finally {
      process.close();
    }
  },
);

const cliListTests = new TestSuite({
  name: "list",
  suite: cliTests,
  async beforeEach({ migrate }: InitializedMigrateTest) {
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
  return decoder.decode(output)
    .replace(/applied at: [^\n]*\n/g, "applied at: {DATE}\n");
}

test(
  cliListTests,
  "all migrations",
  async ({ migrate }) => {
    const process = Deno.run({
      cmd: [
        resolve(migrate.migrationsDir, "../migrate.ts"),
        "list",
      ],
      stdout: "piped",
    });
    try {
      const output = await process.output();
      assertEquals(
        decodeListOutput(output),
        `\
Connecting to database
Checking loaded migrations
All migrations:
  0_user_create.sql
    applied at: {DATE}
  1_user_add_admin.sql
    applied at: {DATE}
  2_user_add_kyle.sql
    applied at: {DATE}
    file moved to: 2_user_add_kyle.ts
  3_user_add_staff.sql
    applied at: {DATE}
    file deleted
  4_user_add_column_email.sql
    not applied
`,
      );
    } finally {
      process.close();
    }
  },
);

test(
  cliListTests,
  "applied migrations",
  async ({ migrate }) => {
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
Connecting to database
Checking loaded migrations
Applied migrations:
  0_user_create.sql
    applied at: {DATE}
  1_user_add_admin.sql
    applied at: {DATE}
  2_user_add_kyle.sql
    applied at: {DATE}
    file moved to: 2_user_add_kyle.ts
  3_user_add_staff.sql
    applied at: {DATE}
    file deleted
`,
      );
    } finally {
      process.close();
    }
  },
);

test(
  cliListTests,
  "unapplied migrations",
  async ({ migrate }) => {
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
Connecting to database
Checking loaded migrations
Unapplied migrations:
  4_user_add_column_email.sql
`,
      );
    } finally {
      process.close();
    }
  },
);

test(
  cliListTests,
  "moved migrations",
  async ({ migrate }) => {
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
Connecting to database
Checking loaded migrations
Moved migrations:
  2_user_add_kyle.sql
    applied at: {DATE}
    file moved to: 2_user_add_kyle.ts
`,
      );
    } finally {
      process.close();
    }
  },
);

test(
  cliListTests,
  "deleted migrations",
  async ({ migrate }) => {
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
Connecting to database
Checking loaded migrations
Deleted migrations:
  3_user_add_staff.sql
    applied at: {DATE}
`,
      );
    } finally {
      process.close();
    }
  },
);

const cliApplyTests = new TestSuite({
  name: "apply",
  suite: cliTests,
  async beforeEach({ migrate }: InitializedMigrateTest) {
    await migrate.connect();
    await migrate.init();
    await migrate.load();
    await migrate.end();
  },
});

test(
  cliApplyTests,
  "all unapplied",
  async ({ migrate }) => {
    const process = Deno.run({
      cmd: [
        resolve(migrate.migrationsDir, "../migrate.ts"),
        "apply",
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
Checking loaded migrations
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

test(
  cliApplyTests,
  "no unapplied",
  async ({ migrate }) => {
    await migrate.connect();
    const migrations = await migrate.getUnapplied();
    for (const migration of migrations) {
      await migrate.apply(migration);
    }
    await migrate.end();

    const process = Deno.run({
      cmd: [
        resolve(migrate.migrationsDir, "../migrate.ts"),
        "apply",
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
Checking loaded migrations
No unapplied migrations
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
