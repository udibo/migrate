import { dirname, fromFileUrl, resolve } from "./deps.ts";
import {
  Migrate,
  MigrateLock,
  Migration,
  MigrationFile,
  MigrationQuery,
} from "./migrate.ts";
import {
  assertEquals,
  assertRejects,
  assertThrows,
  describe,
  ensureDir,
  it,
} from "./test_deps.ts";

function migrationFromFile(
  migration: Pick<Migration, "id" | "path">,
): Migration {
  return {
    ...migration,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

class FakeMigrate extends Migrate {
  async init(): Promise<void> {
    await Promise.resolve();
  }

  async connect(): Promise<void> {
    await Promise.resolve();
  }

  async end(): Promise<void> {
    await Promise.resolve();
  }

  async now(offset = 0): Promise<Date> {
    return await Promise.resolve(new Date(Date.now() + offset));
  }

  async load(): Promise<void> {
    await Promise.resolve();
  }

  async getAll(): Promise<Migration[]> {
    return (await this.getFiles())
      .map((migration) => migrationFromFile(migration));
  }

  async getUnapplied(): Promise<Migration[]> {
    return await this.getAll();
  }

  async apply(migration: Migration): Promise<void> {
    await Promise.resolve(migration);
  }

  async lock(): Promise<MigrateLock> {
    return await Promise.resolve({
      release: () => Promise.resolve(),
    });
  }
}

interface MigrateTest {
  migrate: Migrate;
}

const migrateTests = describe<MigrateTest>({
  name: "Migrate",
  async beforeEach() {
    this.migrate = new FakeMigrate({
      migrationsDir: await Deno.makeTempDir(),
    });
  },
  async afterEach() {
    await Deno.remove(this.migrate.migrationsDir, { recursive: true });
  },
});

it(migrateTests, "resolve works", function () {
  const { migrate } = this;
  let migration = migrationFromFile({
    id: 1,
    path: "0_user_create.sql",
  });
  assertEquals(
    migrate.resolve(migration),
    `${migrate.migrationsDir}/0_user_create.sql`,
  );
  migration = migrationFromFile({
    id: 1,
    path: "2021/10/0_user_create.sql",
  });
  assertEquals(
    migrate.resolve(migration),
    `${migrate.migrationsDir}/2021/10/0_user_create.sql`,
  );
  delete migration.path;
  assertThrows(
    () => migrate.resolve(migration),
    Error,
    "no path for migration",
  );
});

const migrateGetFilesTests = describe({
  name: "getFiles",
  suite: migrateTests,
});

async function touch(path: string) {
  const f = await Deno.create(path);
  f.close();
}

async function assertMigrationFiles(
  migrate: Migrate,
  expected: MigrationFile[],
): Promise<void> {
  const actual = await migrate.getFiles();
  assertEquals(actual, expected);
}

it(
  migrateGetFilesTests,
  "finds migrations in directory",
  async function () {
    const { migrate } = this;
    const expected: MigrationFile[] = [];
    await assertMigrationFiles(migrate, expected);

    const { migrationsDir } = migrate;
    await touch(resolve(migrationsDir, "0_user_create.sql"));
    expected.push({ id: 0, path: "0_user_create.sql" });
    await assertMigrationFiles(migrate, expected);

    await touch(resolve(migrationsDir, "1_user_add_email.sql"));
    expected.push({ id: 1, path: "1_user_add_email.sql" });
    await assertMigrationFiles(migrate, expected);

    await touch(resolve(migrationsDir, "3_user_add_city.sql"));
    expected.push({ id: 3, path: "3_user_add_city.sql" });
    await assertMigrationFiles(migrate, expected);
  },
);

it(
  migrateGetFilesTests,
  "finds migrations in child directories",
  async function () {
    const { migrate } = this;
    const expected: MigrationFile[] = [];
    await assertMigrationFiles(migrate, expected);

    const { migrationsDir } = migrate;
    await touch(resolve(migrationsDir, "0_user_create.sql"));
    expected.push({ id: 0, path: "0_user_create.sql" });
    await assertMigrationFiles(migrate, expected);

    await ensureDir(resolve(migrationsDir, "2021/09"));
    await touch(resolve(migrationsDir, "2021/09/1_user_add_email.sql"));
    expected.push({ id: 1, path: "2021/09/1_user_add_email.sql" });
    await assertMigrationFiles(migrate, expected);

    await ensureDir(resolve(migrationsDir, "2021/10"));
    await touch(resolve(migrationsDir, "2021/10/3_user_add_city.sql"));
    expected.push({ id: 3, path: "2021/10/3_user_add_city.sql" });
    await assertMigrationFiles(migrate, expected);
  },
);

it(
  migrateGetFilesTests,
  "recognizes migrations without name",
  async function () {
    const { migrate } = this;
    const expected: MigrationFile[] = [];
    await assertMigrationFiles(migrate, expected);

    const { migrationsDir } = migrate;
    await touch(resolve(migrationsDir, "0.sql"));
    expected.push({ id: 0, path: "0.sql" });
    await assertMigrationFiles(migrate, expected);
  },
);

it(
  migrateGetFilesTests,
  "recognizes migrations with json, js, or ts extensions",
  async function () {
    const { migrate } = this;
    const expected: MigrationFile[] = [];
    await assertMigrationFiles(migrate, expected);

    const { migrationsDir } = migrate;
    await touch(resolve(migrationsDir, "0_user_create.sql"));
    expected.push({ id: 0, path: "0_user_create.sql" });
    await assertMigrationFiles(migrate, expected);

    await touch(resolve(migrationsDir, "1_user_add_column_email.json"));
    expected.push({ id: 1, path: "1_user_add_column_email.json" });
    await assertMigrationFiles(migrate, expected);

    await touch(resolve(migrationsDir, "2_user_add_admin.js"));
    expected.push({ id: 2, path: "2_user_add_admin.js" });
    await assertMigrationFiles(migrate, expected);

    await touch(resolve(migrationsDir, "3_user_add_kyle.ts"));
    expected.push({ id: 3, path: "3_user_add_kyle.ts" });
    await assertMigrationFiles(migrate, expected);
  },
);

it(
  migrateGetFilesTests,
  "ignores non migration files",
  async function () {
    const { migrate } = this;
    const expected: MigrationFile[] = [];
    await assertMigrationFiles(migrate, expected);

    const { migrationsDir } = migrate;
    await touch(resolve(migrationsDir, "0_user_create.sql"));
    expected.push({ id: 0, path: "0_user_create.sql" });
    await assertMigrationFiles(migrate, expected);

    await touch(resolve(migrationsDir, "-1_user_add_email.sql"));
    await assertMigrationFiles(migrate, expected);

    await touch(resolve(migrationsDir, "README.md"));
    await assertMigrationFiles(migrate, expected);
  },
);

it(
  migrateGetFilesTests,
  "rejects on migration file index collision",
  async function () {
    const { migrate } = this;
    const expected: MigrationFile[] = [];
    await assertMigrationFiles(migrate, expected);

    const { migrationsDir } = migrate;
    await touch(resolve(migrationsDir, "0_user_create.sql"));
    expected.push({ id: 0, path: "0_user_create.sql" });
    await assertMigrationFiles(migrate, expected);

    await touch(resolve(migrationsDir, "0_user_add_email.sql"));
    await assertRejects(
      () => migrate.getFiles(),
      Error,
      "migration id collision on 0",
    );
  },
);

const migrateGetPlanTests = describe({
  name: "getPlan",
  suite: migrateTests,
  beforeEach() {
    this.migrate = new FakeMigrate({
      migrationsDir: this.migrate.migrationsDir,
    });
  },
});

const migrationFile = await Deno.readTextFile(resolve(
  dirname(fromFileUrl(import.meta.url)),
  "examples/postgres/migrations",
  "0_user_create.sql",
));

async function assertPlan(migrate: Migrate, migration: Migration, expect: {
  queries: MigrationQuery[];
  useTransaction: boolean;
}): Promise<void> {
  const { queries, useTransaction } = expect;
  const plan = await migrate.getPlan(migration);
  assertEquals(plan.useTransaction, useTransaction);

  const actualQueries = [];
  for await (const query of plan.queries) {
    actualQueries.push(query);
  }
  assertEquals(actualQueries, queries);
}

it(
  migrateGetPlanTests,
  "from sql migration file",
  async function () {
    const { migrate } = this;
    const migration = migrationFromFile({
      id: 0,
      path: "0_user_create.sql",
    });
    await Deno.writeTextFile(
      migrate.resolve(migration),
      migrationFile,
    );
    await assertPlan(migrate, migration, {
      queries: [migrationFile],
      useTransaction: true,
    });
  },
);

it(
  migrateGetPlanTests,
  "from sql migration file with disableTransaction",
  async function () {
    const { migrate } = this;
    const migration = migrationFromFile({
      id: 0,
      path: "0_user_create.sql",
    });
    const text = `-- migrate disableTransaction\n${migrationFile}`;
    await Deno.writeTextFile(
      migrate.resolve(migration),
      text,
    );

    await assertPlan(migrate, migration, {
      queries: [text],
      useTransaction: false,
    });
  },
);

it(
  migrateGetPlanTests,
  "from json migration file",
  async function () {
    const { migrate } = this;
    const migration = migrationFromFile({
      id: 0,
      path: "0_user_create.json",
    });
    const queries = [{ text: migrationFile }];
    await Deno.writeTextFile(
      migrate.resolve(migration),
      JSON.stringify({ queries }),
    );

    await assertPlan(migrate, migration, {
      queries,
      useTransaction: true,
    });
  },
);

it(
  migrateGetPlanTests,
  "from json migration file with disableTransaction",
  async function () {
    const { migrate } = this;
    const migration = migrationFromFile({
      id: 0,
      path: "0_user_create.json",
    });
    const queries = [{ text: migrationFile }];
    await Deno.writeTextFile(
      migrate.resolve(migration),
      JSON.stringify({ queries, disableTransaction: true }),
    );

    await assertPlan(migrate, migration, {
      queries,
      useTransaction: false,
    });
  },
);

it(
  migrateGetPlanTests,
  "from js migration file",
  async function () {
    const { migrate } = this;
    const migration = migrationFromFile({
      id: 0,
      path: "0_user_create.js",
    });
    const script = `
      export function generateQueries() {
        return [
          {text:${JSON.stringify(migrationFile)}},
        ];
      }
    `;
    await Deno.writeTextFile(
      migrate.resolve(migration),
      script,
    );

    await assertPlan(migrate, migration, {
      queries: [{ text: migrationFile }],
      useTransaction: true,
    });
  },
);

it(
  migrateGetPlanTests,
  "from js migration file with disableTransaction",
  async function () {
    const { migrate } = this;
    const migration = migrationFromFile({
      id: 0,
      path: "0_user_create.js",
    });
    const script = `
      export const disableTransaction = true;
      export function generateQueries() {
        return [
          {text:${JSON.stringify(migrationFile)}},
        ];
      }
    `;
    await Deno.writeTextFile(
      migrate.resolve(migration),
      script,
    );

    await assertPlan(migrate, migration, {
      queries: [{ text: migrationFile }],
      useTransaction: false,
    });
  },
);

const migrateImportPath = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "migrate.ts",
);

it(
  migrateGetPlanTests,
  "from ts migration file",
  async function () {
    const { migrate } = this;
    const migration = migrationFromFile({
      id: 0,
      path: "0_user_create.ts",
    });
    const script = `
      import type { MigrationQuery } from "${migrateImportPath}";
      export function generateQueries(): MigrationQuery[] {
        return [
          {text:${JSON.stringify(migrationFile)}},
        ];
      }
    `;
    await Deno.writeTextFile(
      migrate.resolve(migration),
      script,
    );

    await assertPlan(migrate, migration, {
      queries: [{ text: migrationFile }],
      useTransaction: true,
    });
  },
);

it(
  migrateGetPlanTests,
  "from ts migration file with disableTransaction",
  async function () {
    const { migrate } = this;
    const migration = migrationFromFile({
      id: 0,
      path: "0_user_create.ts",
    });
    const script = `
      import type { MigrationQuery } from "${migrateImportPath}";
      export const disableTransaction = true;
      export function generateQueries(): MigrationQuery[] {
        return [
          {text:${JSON.stringify(migrationFile)}},
        ];
      }
    `;
    await Deno.writeTextFile(
      migrate.resolve(migration),
      script,
    );

    await assertPlan(migrate, migration, {
      queries: [{ text: migrationFile }],
      useTransaction: false,
    });
  },
);

it(
  migrateGetPlanTests,
  "from script migration file with iterator returned",
  async function () {
    const { migrate } = this;
    const migration = migrationFromFile({
      id: 0,
      path: "0_user_create.ts",
    });
    const query = {
      text: 'INSERT INTO "user" (id, username) VALUES ($1, $2)',
      args: [1, "kyle"],
    };
    const script = `
      import type { MigrationQuery } from "${migrateImportPath}";
      export function* generateQueries(): Iterator<MigrationQuery> {
        yield ${JSON.stringify(migrationFile)};
        yield ${JSON.stringify(query)};
      }
    `;
    await Deno.writeTextFile(
      migrate.resolve(migration),
      script,
    );

    await assertPlan(migrate, migration, {
      queries: [
        migrationFile,
        query,
      ],
      useTransaction: true,
    });
  },
);

const depsImportPath = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "deps.ts",
);

it(
  migrateGetPlanTests,
  "from script migration file with async iterator returned",
  async function () {
    const { migrate } = this;
    const migration = migrationFromFile({
      id: 0,
      path: "0_user_create.ts",
    });
    const query = {
      text: 'INSERT INTO "user" (id, username) VALUES ($1, $2)',
      args: [1, "kyle"],
    };
    const script = `
      import type { MigrationQuery } from "${migrateImportPath}";
      import { delay } from "${depsImportPath}";
      export async function* generateQueries(): AsyncIterator<MigrationQuery> {
        await delay(0);
        yield ${JSON.stringify(migrationFile)};
        await delay(0);
        yield ${JSON.stringify(query)};
      }
    `;
    await Deno.writeTextFile(
      migrate.resolve(migration),
      script,
    );

    await assertPlan(migrate, migration, {
      queries: [
        migrationFile,
        query,
      ],
      useTransaction: true,
    });
  },
);

it(
  migrateGetPlanTests,
  "error if migration script missing generateQueries export",
  async function () {
    const { migrate } = this;
    const migration = migrationFromFile({
      id: 0,
      path: "0_user_create.ts",
    });
    const script = `
      import type { MigrationQuery } from "${migrateImportPath}";
      export function generate(): MigrationQuery[] {
        return [
          {text:${JSON.stringify(migrationFile)}},
        ];
      }
    `;
    await Deno.writeTextFile(
      migrate.resolve(migration),
      script,
    );

    await assertRejects(
      () => migrate.getPlan(migration),
      Error,
      "migration script must export generateQueries function",
    );
  },
);

it(
  migrateGetPlanTests,
  "error if migration script generateQueries export is not a function",
  async function () {
    const { migrate } = this;
    const migration = migrationFromFile({
      id: 0,
      path: "0_user_create.ts",
    });
    const script = `
      import type { MigrationQuery } from "${migrateImportPath}";
      export const generateQueries = [
        {text:${JSON.stringify(migrationFile)}},
      ];
    `;
    await Deno.writeTextFile(
      migrate.resolve(migration),
      script,
    );

    await assertRejects(
      () => migrate.getPlan(migration),
      Error,
      "generateQueries is not a function",
    );
  },
);
