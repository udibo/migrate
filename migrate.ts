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

export interface MigrateOptions {
  migrationsDir?: string;
}

/** Base class for object used to apply migrations. */
export abstract class Migrate {
  migrationsDir: string;

  constructor(options: MigrateOptions) {
    this.migrationsDir = resolve(options.migrationsDir ?? "./migrations");
  }

  /** Creates the migration table. */
  abstract init(): Promise<void>;
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
