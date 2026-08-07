ALTER TABLE `transactions` ADD `fingerprint` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_fingerprint_unique` ON `transactions` (`fingerprint`);