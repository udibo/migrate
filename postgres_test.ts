import { delay, dirname, fromFileUrl, resolve } from "./deps.ts";
import {
  assert,
  assertEquals,
  assertObjectMatch,
  assertRejects,
  assertSpyCall,
  assertSpyCalls,
  FakeTime,
  spy,
  stub,
  test,
  TestSuite,
} from "./test_deps.ts";
import { PostgresMigrate } from "./postgres.ts";
import { Migrate } from "./migrate.ts";
import { Client, Transaction } from "./postgres_deps.ts";
import {
  cleanupInit,
  exampleMigrationsDir,
  InitializedMigrateTest,
  MigrateTest,
  options,
} from "./test_postgres.ts";

const migrateTests = new TestSuite({
  name: "PostgresMigrate",
  async afterEach({ migrate }: MigrateTest) {
    if (migrate) {
      await migrate.end();
    }
  },
});

test(migrateTests, "client works", async () => {
  const migrate = new PostgresMigrate(options);
  const { client } = migrate;
  await migrate.connect();
  await client.queryArray("SELECT NOW()");
  await migrate.end();
  await assertRejects(() => client.queryArray("SELECT NOW()"));
});

test(
  migrateTests,
  "duplicate calls to connect or end are ignored",
  async () => {
    const migrate = new PostgresMigrate(options);
    const { client } = migrate;
    await migrate.connect();
    await migrate.connect();
    await client.queryArray("SELECT NOW()");
    await migrate.end();
    await migrate.end();
    await assertRejects(() => client.queryArray("SELECT NOW()"));
  },
);

test(migrateTests, "now gets current date from client", async () => {
  const migrate = new PostgresMigrate(options);
  const { client } = migrate;
  await migrate.connect();
  async function now(): Promise<Date> {
    const { rows } = await client.queryArray<[Date]>("SELECT NOW()");
    return rows[0][0];
  }
  const before = await now();
  const minute = 60 * 1000;
  const actualOffset = await migrate.now(-minute);
  const actual = await migrate.now();
  const after = await now();
  assert(actual >= before);
  assert(actual >= new Date(actualOffset.valueOf() + minute));
  assert(actual <= after);

  await migrate.end();
  await assertRejects(() => client.queryArray("SELECT NOW()"));
});

test(migrateTests, "init", async (context: MigrateTest) => {
  context.migrate = new PostgresMigrate(options);
  const { migrate } = context;
  await cleanupInit(migrate);
  await migrate.init();
  await assertRejects(() => migrate.init());
});

test(
  migrateTests,
  "get returns array of all migrations sorted by id",
  async (context: MigrateTest) => {
    context.migrate = new PostgresMigrate(options);
    const { migrate } = context;
    await cleanupInit(migrate);
    await migrate.init();
    const before = await migrate.now();
    migrate.client.queryArray`
      INSERT INTO migration (id, path, applied_path, applied_at) VALUES
        (0, '0_user_create.sql', '0_user_create.sql', NOW()),
        (1, '1_user_add_column_email.json', '1_user_add_column_email.json', NOW()),
        (2, '2_user_add_admin.js', NULL, NULL),
        (3, '3_user_add_kyle.ts', NULL, NULL);
    `;
    const after = await migrate.now();
    const migrations = await migrate.getAll();

    let migration = migrations[0];
    assertObjectMatch(migration, {
      id: 0,
      path: "0_user_create.sql",
      appliedPath: "0_user_create.sql",
    });
    let { createdAt, updatedAt, appliedAt } = migration;
    assert(createdAt >= before);
    assert(createdAt <= after);
    assertEquals(updatedAt, createdAt);
    assertEquals(appliedAt, createdAt);

    migration = migrations[1];
    assertObjectMatch(migration, {
      id: 1,
      path: "1_user_add_column_email.json",
      appliedPath: "1_user_add_column_email.json",
    });
    ({ createdAt, updatedAt, appliedAt } = migration);
    assert(createdAt >= before);
    assert(createdAt <= after);
    assertEquals(updatedAt, createdAt);
    assertEquals(appliedAt, createdAt);

    migration = migrations[2];
    assertObjectMatch(migration, {
      id: 2,
      path: "2_user_add_admin.js",
      appliedPath: null,
      appliedAt: null,
    });
    assert(createdAt >= before);
    assert(createdAt <= after);
    assertEquals(updatedAt, createdAt);

    migration = migrations[3];
    assertObjectMatch(migration, {
      id: 3,
      path: "3_user_add_kyle.ts",
      appliedPath: null,
      appliedAt: null,
    });
    assert(createdAt >= before);
    assert(createdAt <= after);
    assertEquals(updatedAt, createdAt);

    assertEquals(migrations.slice(4), []);
  },
);

test(
  migrateTests,
  "getUnapplied returns array of unapplied migrations sorted by id",
  async (context: MigrateTest) => {
    context.migrate = new PostgresMigrate(options);
    const { migrate } = context;
    await cleanupInit(migrate);
    await migrate.init();
    const before = await migrate.now();
    migrate.client.queryArray`
      INSERT INTO migration (id, path, applied_path, applied_at) VALUES
        (0, '0_user_create.sql', '0_user_create.sql', NOW()),
        (1, '1_user_add_column_email.json', '1_user_add_column_email.json', NOW()),
        (2, '2_user_add_admin.js', NULL, NULL),
        (3, '3_user_add_kyle.ts', NULL, NULL);
  `;
    const after = await migrate.now();
    const migrations = await migrate.getUnapplied();

    let migration = migrations[0];
    assertObjectMatch(migration, {
      id: 2,
      path: "2_user_add_admin.js",
    });
    let { createdAt, updatedAt, appliedPath, appliedAt } = migration;
    assertEquals(appliedPath, undefined);
    assertEquals(appliedAt, undefined);
    assert(createdAt >= before);
    assert(createdAt <= after);
    assertEquals(updatedAt, createdAt);

    migration = migrations[1];
    assertObjectMatch(migration, {
      id: 3,
      path: "3_user_add_kyle.ts",
    });
    ({ createdAt, updatedAt, appliedPath, appliedAt } = migration);
    assertEquals(appliedPath, undefined);
    assertEquals(appliedAt, undefined);
    assert(createdAt >= before);
    assert(createdAt <= after);
    assertEquals(updatedAt, createdAt);

    assertEquals(migrations.slice(2), []);
  },
);

const migrateLoadTests = new TestSuite({
  name: "load",
  suite: migrateTests,
  async beforeEach(context: InitializedMigrateTest) {
    context.migrate = new PostgresMigrate(options);
    const { migrate } = context;
    await cleanupInit(migrate);
    await migrate.init();
  },
});

test(
  migrateLoadTests,
  "no migrations found",
  async ({ migrate }) => {
    const getFiles = stub(
      migrate,
      "getFiles",
      () => Promise.resolve([]),
    );
    try {
      await migrate.load();
      const migrations = await migrate.getAll();
      assertEquals(migrations, []);
    } finally {
      getFiles.restore();
    }
  },
);

test(
  migrateLoadTests,
  "add migrations for new files",
  async ({ migrate }) => {
    const getFiles = stub(
      migrate,
      "getFiles",
      () =>
        Promise.resolve([
          { id: 0, path: "0_user_create.sql" },
          { id: 1, path: "1_user_add_column_email.sql" },
        ]),
    );
    try {
      const before = await migrate.now();
      await migrate.load();
      const after = await migrate.now();
      const migrations = await migrate.getAll();

      let migration = migrations[0];
      assertObjectMatch(migration, {
        id: 0,
        path: "0_user_create.sql",
        appliedPath: null,
        appliedAt: null,
      });
      assert(migration.createdAt >= before);
      assert(migration.createdAt <= after);
      assertEquals(migration.updatedAt, migration.createdAt);

      migration = migrations[1];
      assertObjectMatch(migration, {
        id: 1,
        path: "1_user_add_column_email.sql",
        appliedPath: null,
        appliedAt: null,
      });
      assert(migration.createdAt >= before);
      assert(migration.createdAt <= after);
      assertEquals(migration.updatedAt, migration.createdAt);

      assertEquals(migrations.slice(2), []);
    } finally {
      getFiles.restore();
    }
  },
);

test(
  migrateLoadTests,
  "delete migrations if unapplied migration file is deleted",
  async ({ migrate }) => {
    const getFiles = stub(
      migrate,
      "getFiles",
      () => Promise.resolve([]),
    );
    try {
      migrate.client.queryArray`
        INSERT INTO migration (id, path, applied_path, applied_at) VALUES
          (0, '0_user_create.sql', '0_user_create.sql', NOW()),
          (1, '1_user_add_column_email.sql', NULL, NULL);
      `;
      const before = await migrate.now();
      await migrate.load();
      const after = await migrate.now();
      const migrations = await migrate.getAll();

      const migration = migrations[0];
      assertObjectMatch(migration, {
        id: 0,
        path: null,
        appliedPath: "0_user_create.sql",
      });
      assert(migration.createdAt <= before);
      assert(migration.updatedAt >= before);
      assert(migration.updatedAt <= after);

      assertEquals(migrations.slice(1), []);
    } finally {
      getFiles.restore();
    }
  },
);

test(
  migrateLoadTests,
  "update migrations if migration file is moved",
  async ({ migrate }) => {
    const getFiles = stub(
      migrate,
      "getFiles",
      () =>
        Promise.resolve([
          { id: 0, path: "applied/0_user_create.sql" },
          { id: 1, path: "unapplied/1_user_add_column_email.sql" },
        ]),
    );
    try {
      migrate.client.queryArray`
        INSERT INTO migration (id, path, applied_path, applied_at) VALUES
          (0, '0_user_create.sql', '0_user_create.sql', NOW()),
          (1, '1_user_add_column_email.sql', NULL, NULL);
      `;
      const before = await migrate.now();
      await migrate.load();
      const after = await migrate.now();
      const migrations = await migrate.getAll();

      let migration = migrations[0];
      assertObjectMatch(migration, {
        id: 0,
        path: "applied/0_user_create.sql",
        appliedPath: "0_user_create.sql",
      });
      assert(migration.createdAt <= before);
      assert(migration.updatedAt >= before);
      assert(migration.updatedAt <= after);

      migration = migrations[1];
      assertObjectMatch(migration, {
        id: 1,
        path: "unapplied/1_user_add_column_email.sql",
        appliedPath: null,
      });
      assert(migration.createdAt <= before);
      assert(migration.updatedAt >= before);
      assert(migration.updatedAt <= after);

      assertEquals(migrations.slice(2), []);
    } finally {
      getFiles.restore();
    }
  },
);

const migrateApplyTests = new TestSuite({
  name: "apply",
  suite: migrateTests,
  async beforeEach(context: InitializedMigrateTest) {
    context.migrate = new PostgresMigrate({
      ...options,
      migrationsDir: await Deno.makeTempDir(),
    });
    const { migrate } = context;
    await cleanupInit(migrate);
    await migrate.init();
    try {
      await migrate.client.queryArray(`DROP TABLE "user"`);
    } catch {
      await migrate.connect();
    }
  },
  async afterEach({ migrate }: InitializedMigrateTest) {
    await migrate.end();
    await Deno.remove(migrate.migrationsDir, { recursive: true });
  },
});

const exampleMigrationFiles = [
  {
    name: "user_create",
    text: await Deno.readTextFile(
      resolve(exampleMigrationsDir, "0_user_create.sql"),
    ),
  },
  {
    name: "user_add_column_email",
    text: await Deno.readTextFile(
      resolve(exampleMigrationsDir, "1_user_add_column_email.sql"),
    ),
  },
];

async function assertApplyFirst(migrate: Migrate, expect: {
  names: string[];
  useTransaction: boolean;
}): Promise<void> {
  const { names, useTransaction } = expect;

  const before = await migrate.now();
  await migrate.load();
  const afterLoad = await migrate.now();
  let migrations = await migrate.getUnapplied();
  const applyQueries = spy(migrate, "_applyQueries");
  try {
    await migrate.apply(migrations[0]);
  } finally {
    applyQueries.restore();
  }
  const afterApply = await migrate.now();

  const call = assertSpyCall(applyQueries, 0);
  assert(
    call.args[1] instanceof (useTransaction ? Transaction : Client),
    `expected ${useTransaction ? "transaction" : "client"} but used ${
      useTransaction ? "client" : "transaction"
    }`,
  );
  assertSpyCalls(applyQueries, 1);

  migrations = await migrate.getAll();
  let migration = migrations[0];
  assertObjectMatch(migration, {
    id: 0,
    path: names[0],
    appliedPath: names[0],
  });
  let { createdAt, updatedAt, appliedAt } = migration;
  assert(createdAt >= before);
  assert(createdAt <= afterLoad);
  assert(updatedAt >= afterLoad);
  assert(updatedAt <= afterApply);
  assert(appliedAt);
  assert(appliedAt >= afterLoad);
  assert(appliedAt <= afterApply);

  migration = migrations[1];
  assertObjectMatch(migration, {
    id: 1,
    path: names[1],
    appliedPath: null,
    appliedAt: null,
  });
  ({ createdAt, updatedAt } = migration);
  assert(createdAt >= before);
  assert(createdAt <= afterLoad);
  assertEquals(updatedAt, createdAt);

  assertEquals(migrations.slice(2), []);
}

const migrateImportPath = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "migrate.ts",
);

test(
  migrateApplyTests,
  "apply migration queries",
  async ({ migrate }) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.ts`),
        `
          import type { MigrationQuery } from "${migrateImportPath}";
          export function generateQueries(): MigrationQuery[] {
            return [
              ${JSON.stringify(migrationFile.text)},
              ${
          JSON.stringify({
            text: `INSERT INTO "user" (id, username) VALUES (100, 'user100')`,
          })
        },
              ${
          JSON.stringify({
            text: 'INSERT INTO "user" (id, username) VALUES ($1, $2)',
            args: [index, `user${index}`],
          })
        },
            ];
          }
        `,
      );
    }

    await assertApplyFirst(migrate, {
      names: ["0_user_create.ts", "1_user_add_column_email.ts"],
      useTransaction: true,
    });
  },
);

test(
  migrateApplyTests,
  "apply migration queries with disableTransaction",
  async ({ migrate }) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.ts`),
        `
          import type { MigrationQuery } from "${migrateImportPath}";
          export const disableTransaction = true;
          export function generateQueries(): MigrationQuery[] {
            return [
              ${JSON.stringify(migrationFile.text)},
              ${
          JSON.stringify({
            text: `INSERT INTO "user" (id, username) VALUES (100, 'user100')`,
          })
        },
              ${
          JSON.stringify({
            text: 'INSERT INTO "user" (id, username) VALUES ($1, $2)',
            args: [index, `user${index}`],
          })
        },
            ];
          }
        `,
      );
    }

    await assertApplyFirst(migrate, {
      names: ["0_user_create.ts", "1_user_add_column_email.ts"],
      useTransaction: false,
    });
  },
);

test(
  migrateApplyTests,
  "apply migration queries from iterable",
  async ({ migrate }) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.ts`),
        `
          import type { MigrationQuery } from "${migrateImportPath}";
          export function* generateQueries(): Iterator<MigrationQuery> {
            yield ${JSON.stringify(migrationFile.text)};
            yield ${
          JSON.stringify({
            text: 'INSERT INTO "user" (id, username) VALUES ($1, $2)',
            args: [index, `user${index}`],
          })
        };
          }
        `,
      );
    }

    await assertApplyFirst(migrate, {
      names: ["0_user_create.ts", "1_user_add_column_email.ts"],
      useTransaction: true,
    });
  },
);

const depsImportPath = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "deps.ts",
);

test(
  migrateApplyTests,
  "apply migration queries from async iterable",
  async ({ migrate }) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.ts`),
        `
          import type { MigrationQuery } from "${migrateImportPath}";
          import { delay } from "${depsImportPath}";
          export async function* generateQueries(): AsyncIterator<MigrationQuery> {
            await delay(0);
            yield ${JSON.stringify(migrationFile.text)};
            await delay(0);
            yield ${
          JSON.stringify({
            text: 'INSERT INTO "user" (id, username) VALUES ($1, $2)',
            args: [index, `user${index}`],
          })
        };
          }
        `,
      );
    }

    await assertApplyFirst(migrate, {
      names: ["0_user_create.ts", "1_user_add_column_email.ts"],
      useTransaction: true,
    });
  },
);

async function assertApplyError(migrate: Migrate, expect: {
  names: string[];
  useTransaction: boolean;
  errorMsg: string;
}): Promise<void> {
  const { names, useTransaction, errorMsg } = expect;

  const before = await migrate.now();
  await migrate.load();
  const afterLoad = await migrate.now();
  let migrations = await migrate.getUnapplied();
  const applyQueries = spy(migrate, "_applyQueries");
  try {
    await assertRejects(() => migrate.apply(migrations[0]), Error, errorMsg);
  } finally {
    applyQueries.restore();
  }

  const call = assertSpyCall(applyQueries, 0);
  assert(
    call.args[1] instanceof (useTransaction ? Transaction : Client),
    `expected ${useTransaction ? "transaction" : "client"} but used ${
      useTransaction ? "client" : "transaction"
    }`,
  );
  assertSpyCalls(applyQueries, 1);

  migrations = await migrate.getAll();
  let migration = migrations[0];
  assertObjectMatch(migration, {
    id: 0,
    path: names[0],
    appliedPath: null,
    appliedAt: null,
  });
  let { createdAt, updatedAt } = migration;
  assert(createdAt >= before);
  assert(createdAt <= afterLoad);
  assertEquals(updatedAt, createdAt);

  migration = migrations[1];
  assertObjectMatch(migration, {
    id: 1,
    path: names[1],
    appliedPath: null,
    appliedAt: null,
  });
  ({ createdAt, updatedAt } = migration);
  assert(createdAt >= before);
  assert(createdAt <= afterLoad);
  assertEquals(updatedAt, createdAt);

  assertEquals(migrations.slice(2), []);
}

test(
  migrateApplyTests,
  "rollback on transaction error",
  async ({ migrate }) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.ts`),
        `
          import type { MigrationQuery } from "${migrateImportPath}";
          export function generateQueries(): MigrationQuery[] {
            return [
              ${JSON.stringify(migrationFile.text)},
              'INSERT INTO "user" (id, username) VALUES (100, NULL)',
            ];
          }
        `,
      );
    }

    await assertApplyError(migrate, {
      names: ["0_user_create.ts", "1_user_add_column_email.ts"],
      useTransaction: true,
      errorMsg: "violates not-null constraint",
    });
  },
);

test(
  migrateApplyTests,
  "rollback on runtime error",
  async ({ migrate }) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.ts`),
        `
          import type { MigrationQuery } from "${migrateImportPath}";
          import { delay } from "${depsImportPath}";
          export async function* generateQueries(): AsyncIterator<MigrationQuery> {
            await delay(0);
            yield ${JSON.stringify(migrationFile.text)};
            await delay(0);
            throw new Error("something went wrong");
          }
        `,
      );
    }

    await assertApplyError(migrate, {
      names: ["0_user_create.ts", "1_user_add_column_email.ts"],
      useTransaction: true,
      errorMsg: "something went wrong",
    });
  },
);

interface LockTest extends InitializedMigrateTest {
  otherMigrate: PostgresMigrate;
  time: FakeTime;
}

const migrateLockTests = new TestSuite({
  name: "lock",
  suite: migrateTests,
  async beforeEach(context: LockTest) {
    context.migrate = new PostgresMigrate(options);
    await context.migrate.connect();
    context.otherMigrate = new PostgresMigrate(options);
    await context.otherMigrate.connect();
    context.time = new FakeTime();
  },
  async afterEach({ otherMigrate, time }: LockTest) {
    await otherMigrate.end();
    time.restore();
  },
});

test(migrateLockTests, "works", async ({ migrate, otherMigrate, time }) => {
  const seq: number[] = [];
  const main = delay(0)
    .then(async () => {
      seq.push(1);
      const lock = await migrate.lock();
      seq.push(2);
      await time.tickAsync(1000);
      seq.push(4);
      await lock.release();
    });
  const other = delay(1)
    .then(async () => {
      seq.push(3);
      const lock = await otherMigrate.lock();
      seq.push(5);
      await lock.release();
    });
  await time.tickAsync();
  await main;
  await time.tickAsync(1000);
  await other;
  assertEquals(seq, [1, 2, 3, 4, 5]);
});

test(migrateLockTests, "abortable", async ({ migrate, otherMigrate, time }) => {
  const seq: number[] = [];
  const controller = new AbortController();
  const main = delay(0)
    .then(async () => {
      seq.push(1);
      const lock = await migrate.lock();
      seq.push(2);
      await time.tickAsync(1000);
      await time.tickAsync(1000);
      controller.abort();
      await time.tickAsync(1000);
      seq.push(5);
      await lock.release();
    });
  const other = delay(1)
    .then(async () => {
      seq.push(3);
      const { signal } = controller;
      await assertRejects(() => otherMigrate.lock({ signal }));
      seq.push(4);
    });
  await time.tickAsync(0);
  await main;
  await time.tickAsync(1000);
  await other;
  assertEquals(seq, [1, 2, 3, 4, 5]);
});
