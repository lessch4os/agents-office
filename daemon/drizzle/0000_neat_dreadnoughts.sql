CREATE TABLE `model_pricing` (
	`model_id` text PRIMARY KEY NOT NULL,
	`input_per_token` real DEFAULT 0 NOT NULL,
	`output_per_token` real DEFAULT 0 NOT NULL,
	`cache_read_per_token` real DEFAULT 0 NOT NULL,
	`context_window` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `raw_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`session_id` text,
	`transport` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`parent_session_id` text,
	`source` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`cwd` text DEFAULT '' NOT NULL,
	`agent_type` text,
	`context_window_limit` integer DEFAULT 200000 NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`tool_call_count` integer DEFAULT 0 NOT NULL,
	`active_ms` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`cache_hit_rate` real DEFAULT 0 NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`model_name` text
);
--> statement-breakpoint
CREATE TABLE `token_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`ts` integer NOT NULL,
	`cumul_input` integer DEFAULT 0 NOT NULL,
	`cumul_output` integer DEFAULT 0 NOT NULL,
	`context_pct` real DEFAULT 0 NOT NULL
);
