import { parse } from "./deps.ts";
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
  console.log("Creating migration table if it does not exist");
  try {
    await migrate.init();
    console.log("Created migration table");
  } catch {
    console.log("Migration table already exists");
  }
}

/**
 * Loads all migrations current path values into the migration table.
 * Returns all unapplied migrations.
 */
export async function loadMigrations(migrate: Migrate): Promise<Migration[]> {
  console.log("Loading migrations");
  const before = await migrate.now();
  let migrations = await migrate.getAll();
  const deletedMigrationIds = new Set(migrations.map(({ id }) => id));
  await migrate.load();
  migrations = await migrate.getAll();
  for (const { id } of migrations) {
    deletedMigrationIds.delete(id);
  }

  const createdMigrations = migrations.filter((migration) =>
    migration.createdAt >= before
  );
  console.log(
    `${createdMigrations.length || "No"} new migration${
      createdMigrations.length !== 1 ? "s" : ""
    } found`,
  );

  if (createdMigrations.length < migrations.length) {
    const updatedMigrations = migrations.filter((migration) =>
      migration.createdAt < before && migration.updatedAt >= before
    );
    console.log(
      `${updatedMigrations.length || "No"} migration${
        updatedMigrations.length !== 1 ? "s" : ""
      } updated`,
    );

    console.log(
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
  console.log("Acquiring migrate lock");
  const lock = await migrate.lock();
  console.log("Acquired migrate lock");

  await loadMigrations(migrate);

  console.log("Releasing migrate lock");
  await lock.release();
  console.log("Released migrate lock");

  console.log("Done");
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

  console.log("Checking loaded migrations");
  for (const migration of await migrate.getAll()) {
    total++;
    const { id, path, appliedPath } = migration;
    if (id > lastId) lastId = id;

    if (!appliedPath) unappliedMigrations.push(migration);
    else if (!path) deletedMigrations.push(migration);
    else if (path != appliedPath) movedMigrations.push(migration);
  }

  console.log("Status:");
  console.log(`  Total: ${total}`);
  console.log(`  Applied: ${total - unappliedMigrations.length}`);

  if (movedMigrations.length) {
    console.log(`  File moved: ${movedMigrations.length}`);
    if (details) {
      for (const migration of movedMigrations) {
        const { path, appliedPath } = migration;
        console.log(`    ${appliedPath} -> ${path}`);
      }
    }
  }

  if (deletedMigrations.length) {
    console.log(`  File deleted: ${deletedMigrations.length}`);
    if (details) {
      for (const migration of deletedMigrations) {
        const { appliedPath } = migration;
        console.log(`    ${appliedPath}`);
      }
    }
  }

  if (unappliedMigrations.length) {
    console.log(`  Not applied: ${unappliedMigrations.length}`);
    if (details) {
      for (const migration of unappliedMigrations) {
        console.log(`    ${migration.path}`);
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
  console.log("Checking loaded migrations");
  let migrations = await migrate.getAll();

  switch (filter) {
    case ListFilter.Applied:
      console.log(
        migrations.length ? "Applied migrations:" : "No applied migrations",
      );
      migrations = migrations.filter((migration: Migration) =>
        migration.appliedAt
      );
      break;
    case ListFilter.Unapplied:
      console.log(
        migrations.length ? "Unapplied migrations:" : "No unapplied migrations",
      );
      migrations = migrations.filter((migration: Migration) =>
        !migration.appliedAt
      );
      break;
    case ListFilter.Moved:
      console.log(
        migrations.length ? "Moved migrations:" : "No moved migrations",
      );
      migrations = migrations.filter((migration: Migration) =>
        !!migration.appliedPath && !!migration.path &&
        migration.appliedPath !== migration.path
      );
      break;
    case ListFilter.Deleted:
      console.log(
        migrations.length ? "Deleted migrations:" : "No deleted migrations",
      );
      migrations = migrations.filter((migration: Migration) => !migration.path);
      break;
    default:
      if (filter != null) console.warn("invalid filter");
      console.log(migrations.length ? "All migrations:" : "No migrations");
  }

  for (const migration of migrations) {
    const { path, appliedPath, appliedAt } = migration;
    console.log(`  ${appliedPath ?? path}`);
    if (appliedAt) {
      console.log(`    applied at: ${appliedAt}`);
    } else if (filter !== ListFilter.Unapplied) {
      console.log(`    not applied`);
    }

    if (appliedPath && path && path !== appliedPath) {
      console.log(`    file moved to: ${path}`);
    }

    if (!path && filter !== ListFilter.Deleted) {
      console.log(`    file deleted`);
    }
  }
}

/** Applies all unapplied migrations. */
export async function applyMigrations(
  migrate: Migrate,
  migrations: Migration[],
): Promise<void> {
  const unappliedMigrations = migrations.filter((migration) =>
    !migration.appliedPath
  );
  console.log(
    `${unappliedMigrations.length || "No"} unapplied migration${
      unappliedMigrations.length !== 1 ? "s" : ""
    }`,
  );
  if (unappliedMigrations.length) {
    for (const migration of unappliedMigrations) {
      console.log(`Applying migration: ${migration.path}`);
      await migrate.apply(migration);
    }
    console.log("Finished applying all migrations");
  }
}

/**
 * Applies all unapplied migrations and outputs the filenames.
 */
export async function apply(migrate: Migrate): Promise<void> {
  console.log("Acquiring migrate lock");
  const lock = await migrate.lock();
  console.log("Acquired migrate lock");

  console.log("Checking loaded migrations");
  const migrations = await migrate.getUnapplied();
  await applyMigrations(migrate, migrations);

  console.log("Releasing migrate lock");
  await lock.release();
  console.log("Released migrate lock");

  console.log("Done");
}

export type Command = (
  migrate: Migrate,
  args?: string[],
) => Promise<unknown>;
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
    console.log("Connecting to database");
    try {
      await migrate.connect();
    } catch (error) {
      console.log("Failed to connect to database");
      throw error;
    }
    await commands[command](migrate, Deno.args.slice(1));
    await migrate.end();
  } else {
    console.log("command not found");
  }
}
