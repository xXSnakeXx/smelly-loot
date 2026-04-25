CREATE TABLE `bis_choice` (
	`player_id` integer NOT NULL,
	`slot` text NOT NULL,
	`desired_source` text DEFAULT 'NotPlanned' NOT NULL,
	`current_source` text DEFAULT 'NotPlanned' NOT NULL,
	`received_at` integer,
	`marker` text,
	PRIMARY KEY(`player_id`, `slot`),
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `boss_kill` (
	`raid_week_id` integer NOT NULL,
	`floor_id` integer NOT NULL,
	`cleared_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`raid_week_id`, `floor_id`),
	FOREIGN KEY (`raid_week_id`) REFERENCES `raid_week`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`floor_id`) REFERENCES `floor`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `floor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tier_id` integer NOT NULL,
	`number` integer NOT NULL,
	`drops` text NOT NULL,
	`tracked_for_algorithm` integer DEFAULT true NOT NULL,
	`page_token_label` text,
	FOREIGN KEY (`tier_id`) REFERENCES `tier`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_tier_number_uidx` ON `floor` (`tier_id`,`number`);--> statement-breakpoint
CREATE TABLE `loot_drop` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`raid_week_id` integer NOT NULL,
	`floor_id` integer NOT NULL,
	`item_key` text NOT NULL,
	`recipient_id` integer,
	`paid_with_pages` integer DEFAULT false NOT NULL,
	`picked_by_algorithm` integer DEFAULT false NOT NULL,
	`score_snapshot` text,
	`notes` text,
	`awarded_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`raid_week_id`) REFERENCES `raid_week`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`floor_id`) REFERENCES `floor`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `loot_week_floor_idx` ON `loot_drop` (`raid_week_id`,`floor_id`);--> statement-breakpoint
CREATE INDEX `loot_recipient_idx` ON `loot_drop` (`recipient_id`);--> statement-breakpoint
CREATE TABLE `page_adjust` (
	`player_id` integer NOT NULL,
	`tier_id` integer NOT NULL,
	`floor_number` integer NOT NULL,
	`delta` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`player_id`, `tier_id`, `floor_number`),
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tier_id`) REFERENCES `tier`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `player` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`name` text NOT NULL,
	`main_job` text NOT NULL,
	`alt_jobs` text DEFAULT (json_array()) NOT NULL,
	`gear_link` text,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `player_team_idx` ON `player` (`team_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `raid_week` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tier_id` integer NOT NULL,
	`week_number` integer NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tier_id`) REFERENCES `tier`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `week_tier_number_uidx` ON `raid_week` (`tier_id`,`week_number`);--> statement-breakpoint
CREATE TABLE `tier` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`name` text NOT NULL,
	`max_ilv` integer NOT NULL,
	`ilv_savage` integer NOT NULL,
	`ilv_tome_up` integer NOT NULL,
	`ilv_catchup` integer NOT NULL,
	`ilv_tome` integer NOT NULL,
	`ilv_extreme` integer NOT NULL,
	`ilv_relic` integer NOT NULL,
	`ilv_crafted` integer NOT NULL,
	`ilv_whyyyy` integer NOT NULL,
	`ilv_just_no` integer NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tier_team_idx` ON `tier` (`team_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `tier_buy_cost` (
	`tier_id` integer NOT NULL,
	`item_key` text NOT NULL,
	`floor_number` integer NOT NULL,
	`cost` integer NOT NULL,
	PRIMARY KEY(`tier_id`, `item_key`),
	FOREIGN KEY (`tier_id`) REFERENCES `tier`(`id`) ON UPDATE no action ON DELETE cascade
);
