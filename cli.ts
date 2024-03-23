import { parse } from "./deps.ts";
import { createMigrationDirectoryIfNotExists, logger } from "./lib.ts";
import { Migrate, Migration } from "./migrate.ts";

/** Filters used by the list command. */
export enum ListFilter {
  Applied = "applied",
  Unapplied = "unapplied",
  Moved = "moved",
  Deleted = "deleted",
}

/** Initializes the migration table for tracking which migrations have been applied. */
export async function init(migrate: Migrate): Promise<void> {
  logger("init", "Initializing migrate...");
  try {
    await migrate.init();
    createMigrationDirectoryIfNotExists(migrate);

    logger(
      "init",
      "Database has been initialised with migrations table and migration timestamp trigger.",
    );

    logger(
      "init",
      "To get started, create your first migration using the filename format of 0_migration_title.{sql,json} and run `apply`",
    );
  } catch {
    logger(
      "error",
      "Migration table already exists. Have you already initialized migrate?",
    );
  }
}

/**
 * Loads all migrations current path values into the migration table.
 * Returns all loaded migrations.
 */
export async function loadMigrations(migrate: Migrate): Promise<Migration[]> {
  const before = await migrate.now();
  let migrations = await migrate.getAll();
  const deletedMigrationIds = new Set(migrations.map(({ id }) => id));
  await migrate.load();
  migrations = await migrate.getAll();
  for (const { id } of migrations) {
    deletedMigrationIds.delete(id);
  }

  const createdMigrations = migrations.filter(
    (migration) => migration.createdAt >= before,
  );
  logger(
    "load",
    `${createdMigrations.length || "No"} new migration${
      createdMigrations.length !== 1 ? "s" : ""
    } found`,
  );

  if (createdMigrations.length < migrations.length) {
    const updatedMigrations = migrations.filter(
      (migration) =>
        migration.createdAt < before && migration.updatedAt >= before,
    );
    logger(
      "load",
      `${updatedMigrations.length || "No"} migration${
        updatedMigrations.length !== 1 ? "s" : ""
      } updated`,
    );

    logger(
      "load",
      `${deletedMigrationIds.size || "No"} migration${
        deletedMigrationIds.size !== 1 ? "s" : ""
      } deleted`,
    );
  }

  return migrations;
}

/**
 * Loads all migrations current path values into the migration table.
 */
export async function load(migrate: Migrate): Promise<void> {
  logger("load", "Acquiring migrate lock");
  const lock = await migrate.lock();
  logger("load", "Acquired migrate lock");

  await loadMigrations(migrate);

  logger("load", "Releasing migrate lock");
  await lock.release();
  logger("load", "Released migrate lock");
  logger(
    "load",
    "Load has completed. New migrations are now in the database. To apply them, please run apply.",
  );
}

/**
 * Outputs the status of all migrations. By default it just outputs the counts.
 * If the --details or -d flag is provided, it will log the filenames of migrations
 * that have not been applied or have been changed since being applied.
 */
export async function status(
  migrate: Migrate,
  args: string[] = [],
): Promise<void> {
  const parsedArgs = parse(args, {
    alias: { d: "details" },
  });
  const { details } = parsedArgs;
  let total = 0,
    lastId = -1;
  const unappliedMigrations: Migration[] = [],
    movedMigrations: Migration[] = [],
    deletedMigrations: Migration[] = [];

  logger("status", "Checking loaded migrations");
  for (const migration of await migrate.getAll()) {
    total++;
    const { id, path, appliedPath } = migration;
    if (id > lastId) lastId = id;

    if (!appliedPath) unappliedMigrations.push(migration);
    else if (!path) deletedMigrations.push(migration);
    else if (path != appliedPath) movedMigrations.push(migration);
  }

  logger("status", `  Total: ${total}`);
  logger("status", `  Applied: ${total - unappliedMigrations.length}`);

  if (movedMigrations.length) {
    logger("status", `  File moved: ${movedMigrations.length}`);
    if (details) {
      for (const migration of movedMigrations) {
        const { path, appliedPath } = migration;
        logger("status", `    ${appliedPath} -> ${path}`);
      }
    }
  }

  if (deletedMigrations.length) {
    logger("status", `  File deleted: ${deletedMigrations.length}`);
    if (details) {
      for (const migration of deletedMigrations) {
        const { appliedPath } = migration;
        logger("status", `    ${appliedPath}`);
      }
    }
  }

  if (unappliedMigrations.length) {
    logger("status", `  Not applied: ${unappliedMigrations.length}`);
    if (details) {
      for (const migration of unappliedMigrations) {
        logger("status", `    ${migration.path}`);
      }
    }
  }
}

/**
 * Outputs a list of migrations. By default it outputs all migrations.
 * If the --filter flag is provided, it will filter the migrations to only include
 * migrations that match the filter.
 * The filter options are applied, unapplied, renamed, and deleted.
 */
export async function list(
  migrate: Migrate,
  args: string[] = [],
): Promise<void> {
  const parsedArgs = parse(args);
  const { filter } = parsedArgs;
  logger("list", "Checking loaded migrations");
  let migrations = await migrate.getAll();

  switch (filter) {
    case ListFilter.Applied:
      logger(
        "list",
        migrations.length ? "Applied migrations:" : "No applied migrations",
      );
      migrations = migrations.filter(
        (migration: Migration) => migration.appliedAt,
      );
      break;
    case ListFilter.Unapplied:
      logger(
        "list",
        migrations.length ? "Unapplied migrations:" : "No unapplied migrations",
      );
      migrations = migrations.filter(
        (migration: Migration) => !migration.appliedAt,
      );
      break;
    case ListFilter.Moved:
      logger(
        "list",
        migrations.length ? "Moved migrations:" : "No moved migrations",
      );
      migrations = migrations.filter(
        (migration: Migration) =>
          !!migration.appliedPath &&
          !!migration.path &&
          migration.appliedPath !== migration.path,
      );
      break;
    case ListFilter.Deleted:
      logger(
        "list",
        migrations.length ? "Deleted migrations:" : "No deleted migrations",
      );
      migrations = migrations.filter((migration: Migration) => !migration.path);
      break;
    default:
      if (filter != null) console.warn("invalid filter");
      logger("list", migrations.length ? "All migrations:" : "No migrations");
  }

  for (const migration of migrations) {
    const { path, appliedPath, appliedAt } = migration;
    logger("list", `  ${appliedPath ?? path}`);
    if (appliedAt) {
      logger("list", `    applied at: ${appliedAt}`);
    } else if (filter !== ListFilter.Unapplied) {
      logger("list", `    not applied`);
    }

    if (appliedPath && path && path !== appliedPath) {
      logger("list", `    file moved to: ${path}`);
    }

    if (!path && filter !== ListFilter.Deleted) {
      logger("list", `    file deleted`);
    }
  }
}

/** Applies all unapplied migrations. */
export async function applyMigrations(
  migrate: Migrate,
  migrations: Migration[],
): Promise<void> {
  const unappliedMigrations = migrations.filter(
    (migration) => !migration.appliedPath,
  );
  logger(
    "apply",
    `${unappliedMigrations.length || "No"} unapplied migration${
      unappliedMigrations.length !== 1 ? "s" : ""
    }`,
  );
  if (unappliedMigrations.length) {
    for (const migration of unappliedMigrations) {
      logger("apply", `Applying migration: ${migration.path}`);
      await migrate.apply(migration);
    }
    logger("apply", "Finished applying all migrations");
  }
}

/**
 * Applies all unapplied migrations and outputs the filenames.
 */
export async function apply(migrate: Migrate): Promise<void> {
  logger("apply", "Acquiring migrate lock");
  const lock = await migrate.lock();
  logger("apply", "Acquired migrate lock");

  logger("apply", "Checking loaded migrations");
  const migrations = await migrate.getUnapplied();
  await applyMigrations(migrate, migrations);

  logger("apply", "Releasing migrate lock");
  await lock.release();
  logger("apply", "Released migrate lock");

  logger("apply", "Migrations applied successfully");
}

export function help() {
  logger(
    "info",
    "Migrate allows you to manage your postgres migrations via the CLI and files in your codebase",
  );
  logger(
    "init",
    "init allows you to initialize your project and creates a migrations table in your database.",
  );
  logger(
    "load",
    "load allows you to add migrations to your database but not run them",
  );
  logger("apply", "apply loads and migrates any unmigrated migrations");
  logger("list", "list shows you all your migration files and their status");
  logger("status", "status gives you an overview of your migrations");
}

export type Command = (
  migrate: Migrate,
  args?: string[],
) => Promise<unknown> | unknown;
export interface Commands {
  [command: string]: Command;
}
/** Commands used by the migrate cli tool. */
export const commands: Commands = {
  init,
  load,
  status,
  list,
  apply,
};

/** Runs migrate commands based on `Deno.args`. */
export async function run(migrate: Migrate) {
  const [command] = Deno.args;

  if (commands[command]) {
    try {
      logger("info", "Connecting to database");
      await migrate.connect();
    } catch (error) {
      logger("error", "Failed to connect to database");
      throw error;
    }
    await commands[command](migrate, Deno.args.slice(1));
    await migrate.end();
  } else {
    if (command == "--help") {
      help();
    } else {
      logger("error", "Command not found or missing argument.");
    }
  }
}
