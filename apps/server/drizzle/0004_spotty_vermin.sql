CREATE TABLE `turn_checkpoints` (
	`turn_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`directory` text NOT NULL,
	`commit` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_command_receipts` (
	`command_id` text PRIMARY KEY NOT NULL,
	`command_name` text NOT NULL,
	`state` text NOT NULL,
	`native_idempotency_key` text,
	`acknowledgement_json` text,
	`result_json` text,
	`error_json` text,
	`reconciliation_error_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "command_receipts_command_name_check" CHECK("command_name" in ('project.open', 'project.updateDefaults', 'session.create', 'session.rename', 'session.delete', 'session.fork', 'session.restore', 'worktree.remove', 'turn.send', 'turn.steer', 'turn.interrupt', 'permission.respond', 'input.respond', 'inventory.refresh', 'instance.start', 'instance.stop', 'instance.restart', 'config.update', 'mcp.reconnect')),
	CONSTRAINT "command_receipts_state_check" CHECK("state" in ('accepted', 'dispatching', 'dispatched', 'uncertain', 'completed', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_command_receipts`("command_id", "command_name", "state", "native_idempotency_key", "acknowledgement_json", "result_json", "error_json", "reconciliation_error_json", "created_at", "updated_at") SELECT "command_id", "command_name", "state", "native_idempotency_key", "acknowledgement_json", "result_json", "error_json", "reconciliation_error_json", "created_at", "updated_at" FROM `command_receipts`;--> statement-breakpoint
DROP TABLE `command_receipts`;--> statement-breakpoint
ALTER TABLE `__new_command_receipts` RENAME TO `command_receipts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `messages` ADD `invocation_json` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `steer_turn_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `worktree_json` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `forked_from_json` text;