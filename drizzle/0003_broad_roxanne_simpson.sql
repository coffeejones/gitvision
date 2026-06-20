CREATE TABLE `watch` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`repo_full_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_swept_at` integer,
	`last_head_sha` text,
	`last_alerted_sha` text,
	`paused` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
