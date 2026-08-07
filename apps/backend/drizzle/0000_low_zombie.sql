CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_date` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL
);
