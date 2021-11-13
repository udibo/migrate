import {
  extname,
  readLines,
  relative,
  resolve,
  StringReader,
  walk,
} from "./deps.ts";

export interface MigrationFile {
  id: number;
  path: string;
}

export interface Migration {
  id: number;
  path?: string;
  appliedPath?: string;
  appliedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function assertMigrationFile(
  migration: Migration,
): asserts migration is Migration & MigrationFile {
  if (!migration.path) throw new Error("no path for migration");
}

export const MIGRATION_FILENAME = /^(\d+)(?:_.+)?.(sql|js|ts|json)$/;

/** Migration query configuration. */
export interface MigrationQueryConfig {
  text: string;
  args?: unknown[];
}

export type MigrationQuery = string | MigrationQueryConfig;

/** JSON representation of a migration. */
export interface MigrationJSON {
  queries: MigrationQuery[];
  disableTransaction?: boolean;
}

/** A script for generating migration queries. */
export interface MigrationScript<GenerateOptions = unknown> {
  generateQueries(options?: GenerateOptions):
    | Iterable<MigrationQuery>
    | AsyncIterable<MigrationQuery>;
  disableTransaction?: boolean;
}

export interface MigrationPlan {
  queries: Iterable<MigrationQuery> | AsyncIterable<MigrationQuery>;
  useTransaction: boolean;
}

export interface MigrateOptions<GenerateOptions = unknown> {
  migrationsDir?: string;
  generateOptions?: GenerateOptions;
}

export interface MigrateLockOptions {
  signal?: AbortSignal;
}

export interface MigrateLock {
  release(): Promise<void>;
}

/** Base class for object used to apply migrations. */
export abstract class Migrate<GenerateOptions = unknown> {
  migrationsDir: string;
  generateOptions?: GenerateOptions;

  constructor(options: MigrateOptions<GenerateOptions>) {
    this.migrationsDir = resolve(options.migrationsDir ?? "./migrations");
    this.generateOptions = options.generateOptions;
  }

  /** Creates the migration table. */
  abstract init(): Promise<void>;
  /** Connects the client. */
  abstract connect(): Promise<void>;
  /** Ends the client connection. */
  abstract end(): Promise<void>;
  /**
   * Acquires an advisory lock for the migrate client.
   * This can be used to ensure only one instance of the migrate script runs at a time.
   * Without locking, it's possible that a migration may get applied multiple times.
   * The lock should be acquired before getting the list of unapplied migrations and
   * the lock should be released after the migrations are applied.
   * With the options, you can override the default advisory lock id and specify an abort signal.
   * The abort signal is only used to abort attempts to acquire it,
   * it will not release an already acquired lock.
   */
  abstract lock(options?: MigrateLockOptions): Promise<MigrateLock>;
  /** Get the current date from the client plus the optional offset in milliseconds. */
  abstract now(offset?: number): Promise<Date>;
  /**
   * Loads all migration's current path values into the migration table.
   * If file was deleted, path will be set to null.
   */
  abstract load(): Promise<void>;
  /** Gets all loaded migrations, sorted by id. */
  abstract getAll(): Promise<Migration[]>;
  /** Gets all loaded migrations that have not been applied yet, sorted by id. */
  abstract getUnapplied(): Promise<Migration[]>;
  /** Applies a migration. */
  abstract apply(migration: Migration): Promise<void>;

  /** Resolves the relative migration path in the migrations directory. */
  resolve(migration: Migration): string {
    assertMigrationFile(migration);
    return resolve(this.migrationsDir, migration.path);
  }

  /** Gets id and path for all migration files, sorted by id. */
  async getFiles(): Promise<MigrationFile[]> {
    const migrations = new Map<number, MigrationFile>();

    for await (const entry of walk(this.migrationsDir)) {
      const match = entry.isFile && entry.name.match(MIGRATION_FILENAME);
      if (!match) continue;

      const id = parseInt(match[1]);
      const path = relative(this.migrationsDir, entry.path);
      if (migrations.has(id)) {
        throw new Error(`migration id collision on ${id}`);
      }
      migrations.set(id, { id, path });
    }

    return [...migrations.values()].sort((a, b) => a.id - b.id);
  }

  /** Gets a migration plan for a migration from its file. */
  async getPlan(migration: Migration): Promise<MigrationPlan> {
    assertMigrationFile(migration);
    const path = this.resolve(migration);
    let useTransaction = true;
    let queries: Iterable<MigrationQuery> | AsyncIterable<MigrationQuery>;
    const ext = extname(path).toLowerCase();
    if (ext === ".sql") {
      const query = await Deno.readTextFile(path);
      for await (const line of readLines(new StringReader(query))) {
        if (line.slice(0, 2) !== "--") break;
        if (line === "-- migrate disableTransaction") useTransaction = false;
      }
      queries = [query];
    } else if (ext === ".json") {
      const migration: MigrationJSON = JSON.parse(
        await Deno.readTextFile(path),
      );
      ({ queries } = migration);
      useTransaction = !migration.disableTransaction;
    } else {
      const { generateQueries, disableTransaction }: MigrationScript<
        GenerateOptions
      > = await import(path);
      if (!generateQueries) {
        throw new Error(
          "migration script must export generateQueries function",
        );
      }
      queries = generateQueries(this.generateOptions);
      useTransaction = !disableTransaction;
    }
    return { queries, useTransaction };
  }
}
