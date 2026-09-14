CREATE OR REPLACE FUNCTION get_top3_summary()
RETURNS TABLE(username TEXT, top1 TEXT, top2 TEXT, top3 TEXT)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE player_merge AS (
    SELECT
      id AS original_id,
      id AS final_id,
      merged_into
    FROM players

    UNION ALL

    SELECT
      pm.original_id,
      p.id AS final_id,
      p.merged_into
    FROM player_merge pm
    JOIN players p
      ON p.id = pm.merged_into
  ),
  resolved_players AS (
    SELECT DISTINCT ON (original_id)
      original_id,
      final_id
    FROM player_merge
    WHERE merged_into IS NULL
    ORDER BY original_id
  ),
  combined_stats AS (
    SELECT
      rp.final_id AS player_id,
      ps.stat_key,
      MAX(ps.stat_value) AS stat_value
    FROM player_stats ps
    JOIN resolved_players rp
      ON rp.original_id = ps.player_id
    WHERE ps.stat_key NOT LIKE '%:%'
    GROUP BY
      rp.final_id,
      ps.stat_key
  ),
  ranked AS (
    SELECT
      player_id,
      stat_key,
      stat_value,
      ROW_NUMBER() OVER (
        PARTITION BY stat_key
        ORDER BY stat_value DESC
      ) AS rank
    FROM combined_stats
  ),
  top3 AS (
    SELECT
      player_id,
      stat_key,
      rank
    FROM ranked
    WHERE rank <= 3
  )
  SELECT
    p.username,
    STRING_AGG(t.stat_key, ',' ORDER BY t.stat_key) FILTER (WHERE t.rank = 1),
    STRING_AGG(t.stat_key, ',' ORDER BY t.stat_key) FILTER (WHERE t.rank = 2),
    STRING_AGG(t.stat_key, ',' ORDER BY t.stat_key) FILTER (WHERE t.rank = 3)
  FROM top3 t
  JOIN players p
    ON p.id = t.player_id
  GROUP BY p.username
  ORDER BY p.username;
$$;
