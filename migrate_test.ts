import { resolve } from "./deps.ts";
import { Migrate, MigrateLock, Migration, MigrationFile } from "./migrate.ts";
import { assertEquals, ensureDir, test, TestSuite } from "./test_deps.ts";

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
    return (await this.getMigrationFiles())
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

const migrateTests = new TestSuite<MigrateTest>({
  name: "Migrate",
  async beforeEach(context) {
    const migrationsDir = await Deno.makeTempDir();
    context.migrate = new FakeMigrate({ migrationsDir });
  },
  async afterEach({ migrate }) {
    await Deno.remove(migrate.migrationsDir, { recursive: true });
  },
});

test(migrateTests, "resolveMigration works", ({ migrate }) => {
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
});

const getMigrationFilesTests = new TestSuite({
  name: "getMigrationFiles",
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
  const actual = await migrate.getMigrationFiles();
  assertEquals(actual, expected);
}

test(
  getMigrationFilesTests,
  "finds migrations in directory",
  async ({ migrate }) => {
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

test(
  getMigrationFilesTests,
  "finds migrations in child directories",
  async ({ migrate }) => {
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

test(
  getMigrationFilesTests,
  "recognizes migrations without name",
  async ({ migrate }) => {
    const expected: MigrationFile[] = [];
    await assertMigrationFiles(migrate, expected);

    const { migrationsDir } = migrate;
    await touch(resolve(migrationsDir, "0.sql"));
    expected.push({ id: 0, path: "0.sql" });
    await assertMigrationFiles(migrate, expected);
  },
);

test(
  getMigrationFilesTests,
  "recognizes migrations with json, js, or ts extensions",
  async ({ migrate }) => {
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

test(
  getMigrationFilesTests,
  "ignores non migration files",
  async ({ migrate }) => {
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
