#!/usr/bin/env -S deno run -A

import { dirname, fromFileUrl, PostgresMigrate, resolve, run } from "./deps.ts";

const isTestBuild = Deno.env.get("MIGRATE_TEST_BUILD") === "true";
const migrate = new PostgresMigrate({
  migrationsDir: resolve(dirname(fromFileUrl(import.meta.url)), "./migrations"),
  client: {
    hostname: isTestBuild ? "postgres" : "localhost",
    port: isTestBuild ? 5432 : 6001,
    database: "postgres",
    user: "postgres",
    password: "postgres",
  },
});

run(migrate);
