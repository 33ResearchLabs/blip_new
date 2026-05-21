// Top-N leaderboard. Reads from the denormalized blip_points columns so the
// query is cheap. Returns one combined ranking across users + merchants, with
// a `kind` discriminator the UI can use for the badge.

import { query } from '@/lib/db';

export interface LeaderboardEntry {
  actor_id: string;
  actor_type: 'user' | 'merchant';
  display_name: string | null;
  username: string | null;
  blip_points: number;
}

export async function getLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  return query<LeaderboardEntry>(
    `
    SELECT id AS actor_id, 'user'::text AS actor_type,
           name AS display_name, username, blip_points
      FROM users
     WHERE COALESCE(blip_points, 0) > 0
    UNION ALL
    SELECT id AS actor_id, 'merchant'::text AS actor_type,
           display_name, username, blip_points
      FROM merchants
     WHERE COALESCE(blip_points, 0) > 0
     ORDER BY blip_points DESC
     LIMIT $1
    `,
    [limit],
  );
}
