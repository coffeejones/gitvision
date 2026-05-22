ALTER TABLE `user` ADD `tier` text DEFAULT 'scout' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `polar_subscription_id` text;--> statement-breakpoint
ALTER TABLE `user` ADD `subscription_status` text;--> statement-breakpoint
ALTER TABLE `user` ADD `current_period_end` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `cancel_at_period_end` integer DEFAULT false NOT NULL;