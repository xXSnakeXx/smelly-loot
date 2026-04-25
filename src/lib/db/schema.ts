import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Application-wide schema definitions.
 *
 * Phase 0 only defines the `team` table; the rest of the loot domain
 * (player, bis_choice, tier, floor, raid_week, loot_drop, …) is
 * introduced as Phase 1 features land, one migration per logical unit.
 */

/**
 * A single static (raid team).
 *
 * The Phase 1 data model assumes one team per deployment, but the schema
 * already supports multiple rows so a future "multi-team" feature
 * (Roadmap Phase 3) won't require a destructive migration.
 *
 * `locale` stores the team's preferred UI language (`de` or `en` for
 * v1.0). Stored as plain text to keep the migration story simple; an
 * enum check constraint can be added later if drift becomes an issue.
 */
export const team = sqliteTable("team", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  locale: text("locale").notNull().default("en"),
  // SQLite has no native timestamp type; Drizzle stores epoch seconds in
  // an integer column when `mode: "timestamp"` is used. The default is
  // applied by the database via `CURRENT_TIMESTAMP`, which Drizzle
  // exposes through the `sql` template tag.
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Team = typeof team.$inferSelect;
export type NewTeam = typeof team.$inferInsert;
