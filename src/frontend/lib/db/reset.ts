import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const runReset = async () => {
  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL not defined");
    process.exit(1);
  }

  const sql = postgres(process.env.POSTGRES_URL);

  try {
    console.log("Dropping tables...");
    await sql`DROP TABLE IF EXISTS "Suggestion" CASCADE`;
    await sql`DROP TABLE IF EXISTS "Stream" CASCADE`;
    await sql`DROP TABLE IF EXISTS "Vote_v2" CASCADE`;
    await sql`DROP TABLE IF EXISTS "Vote" CASCADE`;
    await sql`DROP TABLE IF EXISTS "Message_v2" CASCADE`;
    await sql`DROP TABLE IF EXISTS "Message" CASCADE`;
    await sql`DROP TABLE IF EXISTS "Document" CASCADE`;
    await sql`DROP TABLE IF EXISTS "Chat" CASCADE`;
    console.log("Tables dropped successfully");
  } catch (error) {
    console.error("Error dropping tables:", error);
  } finally {
    await sql.end();
  }
};

runReset();
