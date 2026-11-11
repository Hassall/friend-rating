CREATE TABLE room_limits (
  network TEXT PRIMARY KEY NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX room_limits_bucket ON room_limits (bucket);
--> statement-breakpoint
CREATE INDEX rooms_expiry ON rooms (json_extract(state, '$.expiresAt'));
