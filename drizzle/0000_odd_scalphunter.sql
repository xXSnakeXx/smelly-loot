CREATE TABLE `team` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
