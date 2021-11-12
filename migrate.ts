import { relative, resolve, walk } from "./deps.ts";

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

export const MIGRATION_ENTRY = /^(\d+)(?:_.+)?.(sql|js|ts|json)$/;

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

export interface MigrateOptions {
  migrationsDir?: string;
}

export interface MigrateLockOptions {
  signal?: AbortSignal;
}

export interface MigrateLock {
  release(): Promise<void>;
}

/** Base class for object used to apply migrations. */
export abstract class Migrate {
  migrationsDir: string;

  constructor(options: MigrateOptions) {
    this.migrationsDir = resolve(options.migrationsDir ?? "./migrations");
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
  abstract lock(options: MigrateLockOptions): Promise<MigrateLock>;
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
    if (!migration.path) throw new Error("no path for migration");
    return resolve(this.migrationsDir, migration.path);
  }

  /** Gets id and path for all migration files, sorted by id. */
  async getMigrationFiles(): Promise<MigrationFile[]> {
    const migrations = new Map<number, MigrationFile>();

    for await (const entry of walk(this.migrationsDir)) {
      const match = entry.isFile && entry.name.match(MIGRATION_ENTRY);
      if (!match) continue;

      const id = parseInt(match[1]);
      const path = relative(this.migrationsDir, entry.path);
      if (migrations.has(id)) {
        throw new Error(`duplicate migrations with id ${id}`);
      }
      migrations.set(id, { id, path });
    }

    return [...migrations.values()].sort((a, b) => a.id - b.id);
  }
}
