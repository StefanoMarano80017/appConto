CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_normalized_name_unique` ON `merchants` (`normalized_name`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `merchant_id` text REFERENCES merchants(id);