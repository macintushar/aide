CREATE TABLE `session_file_changes` (
	`session_id` text NOT NULL,
	`path` text NOT NULL,
	`turn_id` text,
	`staged` text NOT NULL,
	`unstaged` text NOT NULL,
	`untracked` integer NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `path`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "session_file_changes_staged_check" CHECK("session_file_changes"."staged" in ('added', 'modified', 'deleted', 'renamed', 'unmodified')),
	CONSTRAINT "session_file_changes_unstaged_check" CHECK("session_file_changes"."unstaged" in ('added', 'modified', 'deleted', 'renamed', 'unmodified'))
);
