import {
  Client,
  ClientOptions,
  Transaction,
  TransactionError,
} from "./postgres_deps.ts";
import {
  Migrate,
  MigrateLock,
  MigrateLockOptions,
  MigrateOptions,
  Migration,
  MigrationQuery,
  MigrationQueryConfig,
} from "./migrate.ts";
import { delay } from "./deps.ts";

export { Client, Migrate, Transaction, TransactionError };
export type {
  ClientOptions,
  MigrateLock,
  MigrateLockOptions,
  MigrateOptions,
  Migration,
  MigrationQuery,
  MigrationQueryConfig,
};

const DEFAULT_LOCK_ID = -8525285245963000605n;
export interface PostgresMigrateLockOptions extends MigrateLockOptions {
  id?: BigInt;
}

export interface PostgresMigrateOptions<GenerateOptions = unknown>
  extends MigrateOptions<GenerateOptions> {
  client?: string | ClientOptions;
}

export class PostgresMigrate<GenerateOptions = unknown>
  extends Migrate<GenerateOptions> {
  client: Client;

  constructor(options: PostgresMigrateOptions<GenerateOptions>) {
    super(options);
    this.client = new Client(options.client);
  }

  async connect(): Promise<void> {
    if (!this.client.connected) await this.client.connect();
  }

  async end(): Promise<void> {
    if (this.client.connected) await this.client.end();
  }

  async init(): Promise<void> {
    const transaction = this.client.createTransaction("migrate_init");
    await transaction.begin();
    await transaction.queryArray`
      CREATE TABLE migration (
        id INT PRIMARY KEY,
        path TEXT,
        applied_path TEXT,
        applied_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    await transaction.queryArray`
      CREATE FUNCTION trigger_migration_timestamp() RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.updated_at = OLD.updated_at THEN
            NEW.updated_at = now();
          END IF;
          RETURN NEW;
        END;
      $$ LANGUAGE plpgsql;
    `;
    await transaction.queryArray`
      CREATE TRIGGER migration_timestamp BEFORE UPDATE ON migration
        FOR EACH ROW
        EXECUTE PROCEDURE trigger_migration_timestamp();
    `;
    await transaction.commit();
  }

  async now(offset?: number): Promise<Date> {
    const { rows } = await this.client.queryArray<[Date]>("SELECT now()");
    const now = rows[0][0];
    return offset ? new Date(now.valueOf() + offset) : now;
  }

  async load(): Promise<void> {
    const migrationFiles = await this.getFiles();

    type Row = Pick<Migration, "id" | "path" | "appliedPath">;
    const { rows } = await this.client.queryObject<Row>({
      text:
        `SELECT id, path, applied_path FROM migration WHERE path IS NOT NULL`,
      camelcase: true,
    });
    const migrationPaths = new Map<number, string>();
    const appliedMigrationIds = new Set<number>();
    const deletedMigrationIds = new Set<number>();
    for (const { id, path, appliedPath } of rows) {
      deletedMigrationIds.add(id);
      if (path) migrationPaths.set(id, path);
      if (appliedPath) appliedMigrationIds.add(id);
    }
    for (const { id } of migrationFiles) {
      deletedMigrationIds.delete(id);
    }

    const UPSERT_MIGRATION_FILE_SQL = `
      INSERT INTO migration (id, path)
        VALUES ($1, $2)
        ON CONFLICT (id)
          DO UPDATE SET path = EXCLUDED.path;
    `;
    for (const id of deletedMigrationIds) {
      if (appliedMigrationIds.has(id)) {
        await this.client.queryArray(UPSERT_MIGRATION_FILE_SQL, [id, null]);
      } else {
        await this.client.queryArray`DELETE FROM migration WHERE id = ${id}`;
      }
    }

    for (const { id, path } of migrationFiles) {
      if (path !== migrationPaths.get(id)) {
        await this.client.queryArray(UPSERT_MIGRATION_FILE_SQL, [id, path]);
      }
    }
  }

  async getAll(): Promise<Migration[]> {
    const { rows } = await this.client.queryObject<Migration>({
      text:
        "SELECT id, path, applied_path, applied_at, created_at, updated_at FROM migration ORDER BY id",
      camelcase: true,
    });
    return rows;
  }

  async getUnapplied(): Promise<Migration[]> {
    const { rows } = await this.client.queryObject<Migration>({
      text:
        "SELECT id, path, created_at, updated_at FROM migration WHERE path IS NOT NULL AND applied_path IS NULL ORDER BY id",
      camelcase: true,
    });
    return rows;
  }

  /** Applies the migration's queries on a client or transaction. */
  async _applyQueries(
    migration: Migration,
    clientOrTransaction: Client | Transaction,
    queries: Iterable<MigrationQuery> | AsyncIterable<MigrationQuery>,
  ): Promise<void> {
    for await (const query of queries) {
      if (typeof query === "string") {
        await clientOrTransaction.queryArray(query);
      } else {
        const { text, args } = query;
        await clientOrTransaction.queryArray(text, args);
      }
    }
    clientOrTransaction.queryArray
      `UPDATE migration SET applied_path = ${migration.path}, applied_at = now() WHERE id = ${migration.id}`;
  }

  async apply(migration: Migration): Promise<void> {
    const { queries, useTransaction } = await this.getPlan(migration);

    const { client } = this;
    if (useTransaction) {
      const transaction = client.createTransaction(
        `migrate_apply_${migration.id}`,
      );
      await transaction.begin();
      try {
        await this._applyQueries(migration, transaction, queries);
        await transaction.commit();
      } catch (error) {
        if (!(error instanceof TransactionError)) {
          await transaction.rollback();
        }
        throw error;
      }
    } else {
      await this._applyQueries(migration, client, queries);
    }
  }

  async lock(
    options: PostgresMigrateLockOptions = { id: DEFAULT_LOCK_ID },
  ): Promise<MigrateLock> {
    const { signal } = options;
    const id = options.id ?? DEFAULT_LOCK_ID;
    const { client } = this;
    let acquired = false;
    while (!acquired) {
      const { rows } = await client.queryArray<[boolean]>`
        SELECT pg_try_advisory_lock(${id});
      `;
      if (rows[0][0]) {
        acquired = true;
      } else {
        await delay(1000, { signal });
      }
    }
    let released = false;
    return {
      async release() {
        if (!released) {
          await client.queryArray`SELECT pg_advisory_unlock(${id})`;
          released = true;
        }
      },
    };
  }
}
