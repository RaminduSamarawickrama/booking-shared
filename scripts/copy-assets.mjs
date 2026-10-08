// tsc only emits JS and type declarations; stylesheets are copied as they are.
import { cpSync, globSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

for (const file of globSync("src/**/*.css")) {
  const target = join("dist", file.slice("src/".length));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(file, target);
}
