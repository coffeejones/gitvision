ALTER TABLE `user` ADD `daily_refresh_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `daily_refresh_date` text;