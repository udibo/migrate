# OAuth2 Server

[![version](https://img.shields.io/badge/release-0.1.0-success)](https://deno.land/x/migrate@0.1.0)
[![deno doc](https://doc.deno.land/badge.svg)](https://doc.deno.land/https/deno.land/x/migrate@0.1.0/adapters/postgres.ts)
[![CI](https://github.com/udibo/migrate/workflows/CI/badge.svg)](https://github.com/udibo/migrate/actions?query=workflow%3ACI)
[![codecov](https://codecov.io/gh/udibo/migrate/branch/main/graph/badge.svg?token=8Q7TSUFWUY)](https://codecov.io/gh/udibo/migrate)
[![license](https://img.shields.io/github/license/udibo/migrate)](https://github.com/udibo/migrate/blob/master/LICENSE)

A migration tool for Deno.

This module was inspired by
[postgres-migrations](https://www.npmjs.com/package/postgres-migrations).

## Design decisions

- Roll forward migrations only
- Simple ordering
- Easily organize migrations
- Each migration runs in a transaction (unless explicitly disabled)

## Installation

To include this module in a Deno project, you can import directly from the TS
files. This module is available in Deno's third part module registry but can
also be imported directly from GitHub using raw content URLs.

```ts
// Import from Deno's third party module registry
import { PostgresMigrate } from "https://deno.land/x/migrate@0.1.0/adapters/postgres.ts";
// Import from GitHub
import { PostgresMigrate } "https://raw.githubusercontent.com/udibo/migrate/0.1.0/adapters/postgres.ts";
```

## Usage

### Postgres

See
[deno docs](https://doc.deno.land/https/deno.land/x/migrate@0.1.0/adapters/postgres.ts)
for more information.

## Contributing

To contribute, please read the [contributing instruction](CONTRIBUTING.md).
