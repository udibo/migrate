# Migrate

[![version](https://img.shields.io/badge/release-0.2.0-success)](https://deno.land/x/migrate@0.2.0)
[![CI](https://github.com/udibo/migrate/workflows/CI/badge.svg)](https://github.com/udibo/migrate/actions?query=workflow%3ACI)
[![codecov](https://codecov.io/gh/udibo/migrate/branch/main/graph/badge.svg?token=8Q7TSUFWUY)](https://codecov.io/gh/udibo/migrate)
[![license](https://img.shields.io/github/license/udibo/migrate)](https://github.com/udibo/migrate/blob/master/LICENSE)

A postgres migration tool for Deno.

This module was inspired by
[postgres-migrations](https://www.npmjs.com/package/postgres-migrations).

## Installation

To include this module in a Deno project, you can import directly from the TS
files. This module is available in Deno's third part module registry but can
also be imported directly from GitHub using raw content URLs.

Currently migrate is only implemented for Postgres. The main entrypoint is
`postgres.ts`.

```ts
// Import from Deno's third party module registry
import { PostgresMigrate } from "https://deno.land/x/migrate@0.2.0/postgres.ts";
// Import from GitHub
import { PostgresMigrate } "https://raw.githubusercontent.com/udibo/migrate/0.2.0/postgres.ts";
```

## Usage

### CLI

To use the command line interface, you must create a script that will initialize
the Migrate instance and call the run command from [cli.ts](cli.ts). An example
can be found [here](#postgres-cli).

See [deno docs](https://doc.deno.land/https/deno.land/x/migrate@0.2.0/cli.ts)
for more information.

#### Command: init

Initializes the migration table for tracking which migrations have been applied.

```
$ ./migrate.ts init
Connecting to database
Creating migration table if it does not exist
Created migration table
```

#### Command: load

Loads all migrations current path values into the migration table.

```
$ ./migrate.ts load
Connecting to database
Acquiring migrate lock
Acquired migrate lock
Loading migrations
2 new migrations found
1 migration updated
No migrations deleted
Releasing migrate lock
Released migrate lock
Done
```

#### Command: status

Outputs the status of all migrations. By default it just outputs the counts.

```
$ ./migrate.ts status
Connecting to database
Checking loaded migrations
Status:
  Total: 5
  Applied: 4
  File moved: 1
  File deleted: 1
  Not applied: 1
```

If the --details or -d flag is provided, it will log the filenames of migrations
that have not been applied or have been changed since being applied.

```
$ ./migrate.ts status --details
Connecting to database
Checking loaded migrations
Status:
  Total: 5
  Applied: 4
  File moved: 1
    2_user_add_kyle.sql -> 2_user_add_kyle.ts
  File deleted: 1
    3_user_add_staff.sql
  Not applied: 1
    4_user_add_column_email.sql
```

#### Command: list

Outputs a list of migrations. By default it outputs all migrations.

```
$ ./migrate.ts list
Connecting to database
Checking loaded migrations
All migrations:
  0_user_create.sql
    applied at: Tue Nov 09 2021 12:10:32 GMT-0600 (Central Standard Time)
  1_user_add_admin.sql
    applied at: Wed Nov 11 2021 18:31:08 GMT-0600 (Central Standard Time)
  2_user_add_kyle.sql
    applied at: Sat Nov 13 2021 05:31:08 GMT-0600 (Central Standard Time)
    file moved to: 2_user_add_kyle.ts
  3_user_add_staff.sql
    applied at: Mon Nov 15 2021 15:31:08 GMT-0600 (Central Standard Time)
    file deleted
  4_user_add_column_email.sql
    not applied
```

If the --filter flag is provided, it will filter the migrations to only include
migrations that match the filter. The filter options are applied, unapplied,
renamed, and deleted.

```
$ ./migrate.ts list --filter=unapplied
Unapplied migrations:
  4_user_add_column_email.sql
```

#### Command: apply

Applies all unapplied migrations and outputs the filenames.

```
$ ./migrate.ts apply
Connecting to database
Acquiring migrate lock
Acquired migrate lock
Checking loaded migrations
2 unapplied migrations
Applying migration: 0_user_create.sql
Applying migration: 1_user_add_column_email.sql
Finished applying all migrations
Releasing migrate lock
Released migrate lock
Done
```

### Postgres

Examples of how to use migrate with postgres can be found
[here](examples/postgres). There are 2 scripts in that folder to demonstrate
different ways to use the migrate module. Only one is required to use the
migrate tool.

See
[deno docs](https://doc.deno.land/https/deno.land/x/migrate@0.2.0/postgres.ts)
for more information.

#### Postgres script

A basic migrate script that will apply all unapplied migrations.

To use this script, copy [migrate_basic.ts](examples/postgres/migrate_basic.ts)
and update it with your migrate configuration.

```
$ ./migrate_basic.ts
Connecting to database
Acquiring migrate lock
Acquired migrate lock
Creating migration table if it does not exist
Created migration table
Loading migrations
Checking for unapplied migrations
2 unapplied migrations found
Applying migration: 0_user_create.sql
Applying migration: 1_user_add_column_email.sql
Finished applying all migrations
Releasing migrate lock
Released migrate lock
Done
```

#### Postgres CLI

A CLI for the migration tool.

To use this script, copy [migrate.ts](examples/postgres/migrate.ts) and update
it with your migrate configuration.

```
$ ./migrate.ts status
Connecting to database
Checking loaded migrations
Status:
  Total: 5
  Applied: 4
  Not applied: 1
```

See [CLI](#cli) for more information about available CLI commands.

## Design decisions

### Roll forward migrations only

If you need to reverse something, you can just push another migration to negate
the migration you want to undo.

### Simple ordering

All migration file names start with an integer index that is used for
determining the order to apply migrations in.

### Easily organize migrations

The entire migrations directory is searched when looking for migration files. If
you would like to organize your migrations instead of having them all in a flat
directory, you can create sub directories for them. You can move or rename the
files before or after they are applied, as long as you don't change their index.

### Each migration runs in a transaction (unless explicitly disabled)

Running in a transaction ensures each migration is atomic. It will either
complete successfully or roll back any changes that were applied before a
failure.

If you have a migration that cannot be run inside a transaction, you can disable
it for that file. This allows migrations such as `CREATE INDEX CONCURRENTLY`
which cannot be run inside a transaction.

### Multiple file formats

Migrations can be stored in sql, json, js, or ts files. Naming your migrations
is recommended but not required. An underscore is used to separate the migration
index from the name if there is one. For example, below is a list of valid
migration filenames.

- 0.sql
- 1_user_create.sql
- 2_user_add_column.json
- 3_user_add_admin.js
- 4_user_add_kyle.ts

#### SQL migration

A SQL migration file should just contain plain SQL. It can have multiple queries
in it. All queries will run in a transaction unless you explicitly disable using
transactions.

```sql
CREATE TABLE "user" (
  id INT PRIMARY KEY,
  username VARCHAR(256) UNIQUE NOT NULL
);
```

To disable the use of a transaction for a SQL migration file, add
`-- migrate disableTransaction` as a SQL comment to the start of the file.

#### JSON migration

A JSON migration file should contain an object with an array of queries. The
queries can be strings or MigrationQueryConfig objects.

```json
{
  "queries": [
    "INSERT INTO \"user\" (id, username) VALUES (1, 'admin')",
    {
      "text": "INSERT INTO \"user\" (id, username) VALUES (2, 'kyle')"
    },
    {
      "text": "INSERT INTO \"user\" (id, username) VALUES ($1, $2)",
      "args": [3, "bot"]
    }
  ]
}
```

To disable the use of a transaction for a JSON migration file, set the
disableTransaction property to true.

#### JS/TS migrations

A JS or TS migration file should export a generateQueries function that returns
an Iterable or AsyncIterable for queries. Like JSON migration files, the queries
can be strings or MigrationQueryConfig objects.

```js
export function generateQueries() {
  return [
    `INSERT INTO "user" (id, username) VALUES (1, 'admin')`,
    {
      text: "INSERT INTO \"user\" (id, username) VALUES (2, 'kyle')",
    },
    {
      text: 'INSERT INTO "user" (id, username) VALUES ($1, $2)',
      args: [3, "bot"],
    },
  ];
}
```

To disable the use of a transaction for a JS or TS migration file, export a
disableTransaction constant that is set to true.

### Concurrency

A locking function is provided for preventing multiple migration scripts from
running at the same time.

## Recommendations

### Migrations should be idempotent

Migrations should only be applied once.

### Migrations should be immutable

Once applied in production, a migration should not be changed. Modifying a
migration that has already been applied may result in you not being able to
reproduce your database.

## Contributing

To contribute, please read the [contributing instruction](CONTRIBUTING.md).
