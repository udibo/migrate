# OAuth2 Server

[![version](https://img.shields.io/badge/release-0.1.0-success)](https://deno.land/x/migrate@0.1.0)
[![CI](https://github.com/udibo/migrate/workflows/CI/badge.svg)](https://github.com/udibo/migrate/actions?query=workflow%3ACI)
[![codecov](https://codecov.io/gh/udibo/migrate/branch/main/graph/badge.svg?token=8Q7TSUFWUY)](https://codecov.io/gh/udibo/migrate)
[![license](https://img.shields.io/github/license/udibo/migrate)](https://github.com/udibo/migrate/blob/master/LICENSE)

A migration tool for Deno.

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
import { PostgresMigrate } from "https://deno.land/x/migrate@0.1.0/postgres.ts";
// Import from GitHub
import { PostgresMigrate } "https://raw.githubusercontent.com/udibo/migrate/0.1.0/postgres.ts";
```

## Usage

### CLI (TODO)

To use the command line interface, you must create a script that will initialize
the Migrate instance and call the run command from [cli.ts](cli.ts).

See [deno docs](https://doc.deno.land/https/deno.land/x/migrate@0.1.0/cli.ts)
for more information.

### Postgres

Examples of how to use migrate with postgres can be found
[here](examples/postgres). There are 2 scripts in that folder to demonstrate
different ways to use the migrate module. Only one is required to use the
migrate tool.

- [migrate.ts](examples/postgres/cli.ts): A cli for the migration tool.
- [migrate_simple.ts](examples/postgres/migrate.ts): A simple migrate script
  that will apply all unapplied migrations.

See
[deno docs](https://doc.deno.land/https/deno.land/x/migrate@0.1.0/postgres.ts)
for more information.

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
it for that file.

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

To disable the use of a transaction for a SQL migration file, add a comment to
the top of the file.

```sql
-- migrate disableTransaction
CREATE TABLE "user" (
  id INT PRIMARY KEY,
  username VARCHAR(256) UNIQUE NOT NULL
);
```

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
