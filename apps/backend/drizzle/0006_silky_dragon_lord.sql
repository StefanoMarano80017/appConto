CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`initial_balance_cents` integer NOT NULL,
	`balance_date` text
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `type` text DEFAULT 'EXPENSE' NOT NULL;