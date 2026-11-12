ALTER TABLE site_activity ADD COLUMN country TEXT;
--> statement-breakpoint
ALTER TABLE site_activity ADD COLUMN player_count INTEGER;
--> statement-breakpoint
ALTER TABLE site_activity ADD COLUMN game_mode TEXT;
--> statement-breakpoint
ALTER TABLE site_activity ADD COLUMN duration_ms INTEGER;
--> statement-breakpoint
DROP TRIGGER room_activity_created;
--> statement-breakpoint
DROP TRIGGER room_activity_updated;
--> statement-breakpoint
CREATE TRIGGER room_activity_created AFTER INSERT ON rooms
WHEN json_extract(NEW.state, '$.createdAt') IS NOT NULL
BEGIN
  INSERT INTO site_activity (room_id, kind, occurred_at)
  VALUES (NEW.id, 'room_created', json_extract(NEW.state, '$.createdAt'));

  INSERT INTO site_activity (room_id, kind, player_id, country, occurred_at)
  VALUES (NEW.id, 'player_joined', json_extract(NEW.state, '$.players[0].id'),
    json_extract(NEW.state, '$.players[0].country'), json_extract(NEW.state, '$.players[0].joinedAt'));
END;
--> statement-breakpoint
CREATE TRIGGER room_activity_updated AFTER UPDATE OF state ON rooms
WHEN json_extract(NEW.state, '$.createdAt') IS NOT NULL
BEGIN
  INSERT INTO site_activity (room_id, kind, player_id, country, occurred_at)
  SELECT NEW.id, 'player_joined', json_extract(player.value, '$.id'),
    json_extract(player.value, '$.country'), json_extract(player.value, '$.joinedAt')
  FROM json_each(NEW.state, '$.players') AS player
  WHERE json_extract(player.value, '$.joinedAt') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM json_each(OLD.state, '$.players') AS old_player
      WHERE json_extract(old_player.value, '$.id') = json_extract(player.value, '$.id')
    );

  INSERT INTO site_activity (room_id, kind, player_count, game_mode, occurred_at)
  SELECT NEW.id, 'game_started', json_array_length(NEW.state, '$.players'),
    CASE
      WHEN json_extract(NEW.state, '$.options.mostLikely') AND json_extract(NEW.state, '$.options.guessing') THEN 'both'
      WHEN json_extract(NEW.state, '$.options.mostLikely') THEN 'most_likely'
      WHEN json_extract(NEW.state, '$.options.guessing') THEN 'guessing'
      ELSE 'classic'
    END,
    json_extract(NEW.state, '$.startedAt')
  WHERE json_extract(NEW.state, '$.startedAt') IS NOT NULL
    AND json_extract(OLD.state, '$.startedAt') IS NULL;

  INSERT INTO site_activity (room_id, kind, duration_ms, occurred_at)
  SELECT NEW.id, 'game_completed',
    json_extract(NEW.state, '$.stage.revealAt') - json_extract(NEW.state, '$.startedAt'),
    json_extract(NEW.state, '$.stage.revealAt')
  WHERE json_extract(NEW.state, '$.stage.phase') = 'reveal'
    AND json_extract(OLD.state, '$.stage.phase') IS NOT 'reveal';
END;
