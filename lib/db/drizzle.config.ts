import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  // Explicit, and absolute. `out` defaults to ./drizzle relative to the working
  // directory, which is right only while the command happens to be run from
  // lib/db. Resolving it from the config file's own location means the same
  // migrations are found however the script is invoked.
  out: path.join(__dirname, "./drizzle"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
