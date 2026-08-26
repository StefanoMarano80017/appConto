CREATE TABLE `loans` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`borrower_name` text NOT NULL,
	`description` text,
	`amount_cents` integer NOT NULL,
	`lent_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `loans_transaction_id_idx` ON `loans` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `loan_repayments` (
	`id` text PRIMARY KEY NOT NULL,
	`loan_id` text NOT NULL,
	`transaction_id` text,
	`amount_cents` integer NOT NULL,
	`repayment_date` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `loan_repayments_loan_id_idx` ON `loan_repayments` (`loan_id`);--> statement-breakpoint
CREATE INDEX `loan_repayments_transaction_id_idx` ON `loan_repayments` (`transaction_id`);
