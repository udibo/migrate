import { Migrate } from "./postgres.ts";

type CLI_FUNCTION = keyof typeof colors;

const colors: Record<string, string> = {
  apply: "purple",
  init: "green",
  error: "red",
  info: "blue",
  list: "orange",
  load: "pink",
};

export const logger = (cliFunction: CLI_FUNCTION, ...message: string[]) => {
  console.log(
    `%c[${cliFunction.toUpperCase()}]:`,
    `color: ${colors[cliFunction]};`,
    ...message,
  );
};

export const createMigrationDirectoryIfNotExists = (migrate: Migrate) => {
  try {
    Deno.mkdirSync(migrate.migrationsDir);
    logger("init", "The migrations directory has been created.");
  } catch (_err) {
    return;
  }
};
