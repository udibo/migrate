import { Client, dirname, fromFileUrl, resolve, Transaction } from "../deps.ts";
import {
  assert,
  assertEquals,
  assertObjectMatch,
  assertRejects,
  assertSpyCall,
  assertSpyCalls,
  spy,
  stub,
  test,
  TestSuite,
} from "../test_deps.ts";
import { PostgresMigrate, PostgresMigrateOptions } from "./postgres.ts";
import { Migrate } from "../migrate.ts";

interface PostgresMigrateTest {
  migrate?: PostgresMigrate;
}

const migrateTests = new TestSuite({
  name: "PostgresMigrate",
  async afterEach({ migrate }: PostgresMigrateTest) {
    if (migrate) {
      await migrate.end();
    }
  },
});

const isTestBuild = Deno.env.get("MIGRATE_TEST_BUILD") === "true";
const options: PostgresMigrateOptions = {
  client: {
    hostname: isTestBuild ? "postgres" : "localhost",
    port: isTestBuild ? 5432 : 6001,
    database: "postgres",
    user: "postgres",
    password: "postgres",
  },
};

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
  const actual = await migrate.now();
  const after = await now();
  assert(actual >= before);
  assert(actual <= after);

  await migrate.end();
  await assertRejects(() => client.queryArray("SELECT NOW()"));
});

async function cleanupInit(migrate: PostgresMigrate) {
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

test(migrateTests, "init", async (context: PostgresMigrateTest) => {
  context.migrate = new PostgresMigrate(options);
  const { migrate } = context;
  await cleanupInit(migrate);
  await migrate.init();
  await assertRejects(() => migrate.init());
});

test(
  migrateTests,
  "get returns array of all migrations sorted by id",
  async (context: PostgresMigrateTest) => {
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
  async (context: PostgresMigrateTest) => {
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

interface InitializedMigrationsTest extends PostgresMigrateTest {
  migrate: PostgresMigrate;
}

const migrateLoadTests = new TestSuite({
  name: "load",
  suite: migrateTests,
  async beforeEach(context: InitializedMigrationsTest) {
    context.migrate = new PostgresMigrate(options);
    const { migrate } = context;
    await cleanupInit(migrate);
    await migrate.init();
  },
});

test(
  migrateLoadTests,
  "no migrations found",
  async ({ migrate }: InitializedMigrationsTest) => {
    const getMigrationFiles = stub(
      migrate,
      "getMigrationFiles",
      () => Promise.resolve([]),
    );
    try {
      await migrate.load();
      const migrations = await migrate.getAll();
      assertEquals(migrations, []);
    } finally {
      getMigrationFiles.restore();
    }
  },
);

test(
  migrateLoadTests,
  "add migrations for new files",
  async ({ migrate }: InitializedMigrationsTest) => {
    const getMigrationFiles = stub(
      migrate,
      "getMigrationFiles",
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
      getMigrationFiles.restore();
    }
  },
);

test(
  migrateLoadTests,
  "delete migrations if unapplied migration file is deleted",
  async ({ migrate }: InitializedMigrationsTest) => {
    const getMigrationFiles = stub(
      migrate,
      "getMigrationFiles",
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

      assertEquals(migrations.slice(2), []);
    } finally {
      getMigrationFiles.restore();
    }
  },
);

test(
  migrateLoadTests,
  "update migrations if migration file is moved",
  async ({ migrate }: InitializedMigrationsTest) => {
    const getMigrationFiles = stub(
      migrate,
      "getMigrationFiles",
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
      assert(migration.createdAt >= before);
      assert(migration.createdAt <= after);
      assertEquals(migration.updatedAt, migration.createdAt);

      assertEquals(migrations.slice(2), []);
    } finally {
      getMigrationFiles.restore();
    }
  },
);

const migrateApplyTests = new TestSuite({
  name: "apply",
  suite: migrateTests,
  async beforeEach(context: InitializedMigrationsTest) {
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
  async afterEach({ migrate }: InitializedMigrationsTest) {
    await migrate.end();
    await Deno.remove(migrate.migrationsDir, { recursive: true });
  },
});

const exampleMigrationsDir = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "../examples/postgres/migrations",
);

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

test(
  migrateApplyTests,
  "apply sql migration file",
  async ({ migrate }: InitializedMigrationsTest) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.sql`),
        migrationFile.text,
      );
    }

    await assertApplyFirst(migrate, {
      names: ["0_user_create.sql", "1_user_add_column_email.sql"],
      useTransaction: true,
    });
  },
);

test(
  migrateApplyTests,
  "apply sql migration file with disableTransaction",
  async ({ migrate }: InitializedMigrationsTest) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.sql`),
        `-- migrate disableTransaction\n${migrationFile.text}`,
      );
    }

    await assertApplyFirst(migrate, {
      names: ["0_user_create.sql", "1_user_add_column_email.sql"],
      useTransaction: false,
    });
  },
);

test(
  migrateApplyTests,
  "apply json migration file",
  async ({ migrate }: InitializedMigrationsTest) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.json`),
        JSON.stringify({
          queries: [{ text: migrationFile.text }],
        }),
      );
    }

    await assertApplyFirst(migrate, {
      names: ["0_user_create.json", "1_user_add_column_email.json"],
      useTransaction: true,
    });
  },
);

test(
  migrateApplyTests,
  "apply json migration file with disableTransaction",
  async ({ migrate }: InitializedMigrationsTest) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.json`),
        JSON.stringify({
          disableTransaction: true,
          queries: [{ text: migrationFile.text }],
        }),
      );
    }

    await assertApplyFirst(migrate, {
      names: ["0_user_create.json", "1_user_add_column_email.json"],
      useTransaction: false,
    });
  },
);

test(
  migrateApplyTests,
  "apply js migration file",
  async ({ migrate }: InitializedMigrationsTest) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.js`),
        `
        export function generateQueries() {
          return [
            {text:${JSON.stringify(migrationFile.text)}},
          ]
        }
      `,
      );
    }

    await assertApplyFirst(migrate, {
      names: ["0_user_create.js", "1_user_add_column_email.js"],
      useTransaction: true,
    });
  },
);

test(
  migrateApplyTests,
  "apply js migration file with disableTransaction",
  async ({ migrate }: InitializedMigrationsTest) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.js`),
        `
          export const disableTransaction = true;
          export function generateQueries() {
            return [
              {text:${JSON.stringify(migrationFile.text)}},
            ]
          }
        `,
      );
    }

    await assertApplyFirst(migrate, {
      names: ["0_user_create.js", "1_user_add_column_email.js"],
      useTransaction: false,
    });
  },
);

test(
  migrateApplyTests,
  "apply ts migration file",
  async ({ migrate }: InitializedMigrationsTest) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.ts`),
        `
        export function generateQueries(): string[] {
          return [
            ${JSON.stringify(migrationFile.text)},
          ]
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
  "apply ts migration file with disableTransaction",
  async ({ migrate }: InitializedMigrationsTest) => {
    for (const [index, migrationFile] of exampleMigrationFiles.entries()) {
      await Deno.writeTextFile(
        resolve(migrate.migrationsDir, `${index}_${migrationFile.name}.ts`),
        `
          export const disableTransaction = true;
          export function generateQueries(): string[] {
            return [
              ${JSON.stringify(migrationFile.text)},
            ]
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
