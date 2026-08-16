CREATE TABLE `adapter_id_mappings` (
	`instance_id` text NOT NULL,
	`mapping_kind` text NOT NULL,
	`aide_id` text NOT NULL,
	`native_id` text NOT NULL,
	PRIMARY KEY(`instance_id`, `mapping_kind`, `aide_id`),
	CONSTRAINT "adapter_id_mappings_kind_check" CHECK("adapter_id_mappings"."mapping_kind" in ('message', 'part', 'request'))
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`mime_type` text NOT NULL,
	`data` blob NOT NULL,
	`byte_length` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "artifacts_byte_length_check" CHECK("artifacts"."byte_length" >= 0)
);
--> statement-breakpoint
CREATE TABLE `command_receipts` (
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
	CONSTRAINT "command_receipts_command_name_check" CHECK("command_receipts"."command_name" in ('project.open', 'project.updateDefaults', 'session.create', 'session.rename', 'session.delete', 'turn.send', 'turn.interrupt', 'permission.respond', 'input.respond', 'inventory.refresh', 'instance.start', 'instance.stop', 'instance.restart', 'config.update', 'mcp.reconnect')),
	CONSTRAINT "command_receipts_state_check" CHECK("command_receipts"."state" in ('accepted', 'dispatching', 'dispatched', 'uncertain', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `config_records` (
	`kind` text NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`config_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`kind`, `project_id`),
	CONSTRAINT "config_records_target_check" CHECK(("config_records"."kind" = 'global' and "config_records"."project_id" = '') or ("config_records"."kind" = 'project' and "config_records"."project_id" <> ''))
);
--> statement-breakpoint
CREATE TABLE `dispatch_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`native_session_id` text NOT NULL,
	`role` text NOT NULL,
	`from_message_seq` integer NOT NULL,
	`through_message_seq` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "dispatch_inputs_role_check" CHECK("dispatch_inputs"."role" = 'handoff'),
	CONSTRAINT "dispatch_inputs_message_range_check" CHECK("dispatch_inputs"."from_message_seq" >= 0 and "dispatch_inputs"."through_message_seq" >= "dispatch_inputs"."from_message_seq")
);
--> statement-breakpoint
CREATE TABLE `event_log` (
	`scope_kind` text NOT NULL,
	`scope_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`timestamp` text NOT NULL,
	`event_json` text NOT NULL,
	PRIMARY KEY(`scope_kind`, `scope_id`, `sequence`),
	CONSTRAINT "event_log_scope_check" CHECK(("event_log"."scope_kind" = 'session' and "event_log"."scope_id" <> '') or ("event_log"."scope_kind" = 'instances' and "event_log"."scope_id" = '')),
	CONSTRAINT "event_log_sequence_check" CHECK("event_log"."sequence" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_log_event_id_unique` ON `event_log` (`event_id`);--> statement-breakpoint
CREATE TABLE `inventory_cache` (
	`instance_id` text NOT NULL,
	`directory` text NOT NULL,
	`inventory_json` text NOT NULL,
	`revision` text NOT NULL,
	`discovered_at` text NOT NULL,
	`stale` integer NOT NULL,
	PRIMARY KEY(`instance_id`, `directory`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`parent_message_id` text,
	`execution_json` text,
	`usage_json` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "messages_seq_check" CHECK("messages"."seq" >= 0),
	CONSTRAINT "messages_role_check" CHECK("messages"."role" in ('user', 'assistant')),
	CONSTRAINT "messages_role_fields_check" CHECK(("messages"."role" = 'user' and "messages"."parent_message_id" is null and "messages"."execution_json" is not null) or ("messages"."role" = 'assistant' and "messages"."parent_message_id" is not null and "messages"."execution_json" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_session_id_seq_unique` ON `messages` (`session_id`,`seq`);--> statement-breakpoint
CREATE TABLE `native_session_mappings` (
	`session_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`native_session_id` text NOT NULL,
	`resume_cursor` text,
	`sync_cursor` integer DEFAULT -1 NOT NULL,
	`unsafe` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`session_id`, `instance_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "native_session_mappings_sync_cursor_check" CHECK("native_session_mappings"."sync_cursor" >= -1)
);
--> statement-breakpoint
CREATE TABLE `parts` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`index` integer NOT NULL,
	`type` text NOT NULL,
	`data_json` text NOT NULL,
	`artifact_id` text,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "parts_index_check" CHECK("parts"."index" >= 0),
	CONSTRAINT "parts_type_check" CHECK("parts"."type" in ('text', 'reasoning', 'tool', 'file', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parts_message_id_index_unique` ON `parts` (`message_id`,`index`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`directory` text NOT NULL,
	`created_at` text NOT NULL,
	`last_opened_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`payload_json` text NOT NULL,
	`resolution_json` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "requests_kind_check" CHECK("requests"."kind" in ('permission', 'input')),
	CONSTRAINT "requests_status_check" CHECK("requests"."status" in ('open', 'resolved', 'cancelled')),
	CONSTRAINT "requests_resolution_check" CHECK(("requests"."status" = 'resolved' and "requests"."resolution_json" is not null) or ("requests"."status" <> 'resolved' and "requests"."resolution_json" is null))
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`status` text NOT NULL,
	`execution_json` text NOT NULL,
	`command_id` text NOT NULL,
	`user_message_id` text NOT NULL,
	`assistant_message_id` text,
	`started_at` text,
	`ended_at` text,
	`error_json` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`command_id`) REFERENCES `command_receipts`(`command_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "turns_seq_check" CHECK("turns"."seq" >= 0),
	CONSTRAINT "turns_status_check" CHECK("turns"."status" in ('queued', 'running', 'completed', 'interrupted', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turns_session_id_seq_unique` ON `turns` (`session_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `turns_command_id_unique` ON `turns` (`command_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `turns_user_message_id_unique` ON `turns` (`user_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `turns_assistant_message_id_unique` ON `turns` (`assistant_message_id`);