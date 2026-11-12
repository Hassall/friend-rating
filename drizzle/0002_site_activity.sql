CREATE TABLE site_activity (
  room_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  player_id TEXT NOT NULL DEFAULT '',
  display_name TEXT,
  is_host INTEGER NOT NULL DEFAULT 0,
  occurred_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, kind, player_id)
);
--> statement-breakpoint
CREATE INDEX site_activity_time ON site_activity (occurred_at);
--> statement-breakpoint
CREATE INDEX site_activity_kind_time ON site_activity (kind, occurred_at);
--> statement-breakpoint
CREATE TRIGGER room_activity_created AFTER INSERT ON rooms
WHEN json_extract(NEW.state, '$.createdAt') IS NOT NULL
BEGIN
  INSERT INTO site_activity (room_id, kind, occurred_at)
  VALUES (NEW.id, 'room_created', json_extract(NEW.state, '$.createdAt'));

  INSERT INTO site_activity (room_id, kind, player_id, display_name, is_host, occurred_at)
  VALUES (NEW.id, 'player_joined', json_extract(NEW.state, '$.players[0].id'),
    json_extract(NEW.state, '$.players[0].name'), 1,
    json_extract(NEW.state, '$.players[0].joinedAt'));
END;
--> statement-breakpoint
CREATE TRIGGER room_activity_updated AFTER UPDATE OF state ON rooms
WHEN json_extract(NEW.state, '$.createdAt') IS NOT NULL
BEGIN
  INSERT INTO site_activity (room_id, kind, player_id, display_name, occurred_at)
  SELECT NEW.id, 'player_joined', json_extract(player.value, '$.id'),
    json_extract(player.value, '$.name'), json_extract(player.value, '$.joinedAt')
  FROM json_each(NEW.state, '$.players') AS player
  WHERE json_extract(player.value, '$.joinedAt') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM json_each(OLD.state, '$.players') AS old_player
      WHERE json_extract(old_player.value, '$.id') = json_extract(player.value, '$.id')
    );

  INSERT INTO site_activity (room_id, kind, occurred_at)
  SELECT NEW.id, 'game_started', json_extract(NEW.state, '$.startedAt')
  WHERE json_extract(NEW.state, '$.startedAt') IS NOT NULL
    AND json_extract(OLD.state, '$.startedAt') IS NULL;

  INSERT INTO site_activity (room_id, kind, occurred_at)
  SELECT NEW.id, 'game_completed', json_extract(NEW.state, '$.stage.revealAt')
  WHERE json_extract(NEW.state, '$.stage.phase') = 'reveal'
    AND json_extract(OLD.state, '$.stage.phase') IS NOT 'reveal';
END;
