import { randomBytes } from 'node:crypto';
// Storage in Postgres. On Vercel, DATABASE_URL points at the hosted database (Neon).
// Without it (local runs and tests), an embedded Postgres (PGlite) is used instead.
// Grades are not stored here: they come from data/agents.json (see scripts/sync-grades.mjs).
const SCHEMA = `
  -- Members. The id says how they signed in: "linkedin:…", "google:…", "github:…" or "email:<address>".
  CREATE TABLE IF NOT EXISTS members (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL DEFAULT '',
    first_name     TEXT,
    last_name      TEXT,
    email          TEXT,
    email_verified BOOLEAN NOT NULL DEFAULT false,
    photo_url      TEXT,
    github_login   TEXT,
    -- What brings them here: builds agents, uses agents, or just curious. Asked once when joining.
    role           TEXT,
    consent_at     TIMESTAMPTZ,
    -- The Squawk, the weekly email. Off until the member ticks the box.
    squawk_optin   BOOLEAN NOT NULL DEFAULT false,
    -- Growth: the tag on the link they first followed, who invited them, their own invite code and member number.
    joined_from    TEXT,
    referred_by    TEXT,
    invite_code    TEXT,
    member_number  INTEGER,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS members_invite_code ON members (invite_code);
  -- One-time "sign in by email" links. Only a hash of each link's secret is stored.
  CREATE TABLE IF NOT EXISTS login_tokens (
    token_hash TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ
  );
  -- The Daily Hallucination: five satirical stories a day, each linked to the real article it's based on,
  -- and optionally to one tested agent in a plain "Polly Tested" box.
  CREATE TABLE IF NOT EXISTS stories (
    id             SERIAL PRIMARY KEY,
    day            TEXT NOT NULL,
    position       INTEGER NOT NULL,
    headline       TEXT NOT NULL,
    body           TEXT NOT NULL,
    agent_id       TEXT,
    source         TEXT NOT NULL,
    source_title   TEXT NOT NULL,
    source_link    TEXT NOT NULL,
    source_summary TEXT,
    hidden         BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS stories_day ON stories (day);
  -- Agents in the directory that have not been Polly Tested yet. Visitors suggest them; the organiser lists them.
  CREATE TABLE IF NOT EXISTS listings (
    id           SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    url          TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    category     TEXT NOT NULL DEFAULT 'assistants',
    status       TEXT NOT NULL DEFAULT 'suggested',
    suggested_by TEXT REFERENCES members (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- Agents listed in other public directories (Official MCP Registry, ERC-8004), synced daily by
  -- src/directories.js. Shown as "not Polly Tested yet". tested_id is set when it is one of our graded agents.
  CREATE TABLE IF NOT EXISTS listed_agents (
    source      TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    url         TEXT,
    endpoint    TEXT,
    image       TEXT,
    chain       TEXT,
    x402        BOOLEAN NOT NULL DEFAULT false,
    tested_id   TEXT,
    updated_at  TIMESTAMPTZ,
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, source_id)
  );
  CREATE INDEX IF NOT EXISTS listed_agents_tested ON listed_agents (tested_id);
  -- Who made it (a GitHub login, a domain or a wallet), when it first appeared, and the rest of what the source says.
  ALTER TABLE listed_agents ADD COLUMN IF NOT EXISTS maker_key TEXT;
  ALTER TABLE listed_agents ADD COLUMN IF NOT EXISTS maker_name TEXT;
  ALTER TABLE listed_agents ADD COLUMN IF NOT EXISTS maker_url TEXT;
  ALTER TABLE listed_agents ADD COLUMN IF NOT EXISTS first_published_at TIMESTAMPTZ;
  ALTER TABLE listed_agents ADD COLUMN IF NOT EXISTS details JSONB;
  CREATE INDEX IF NOT EXISTS listed_agents_maker ON listed_agents (maker_key);
  -- Spot the Hallucination results, one row per member per day, for streaks and the weekly email.
  CREATE TABLE IF NOT EXISTS game_results (
    day        TEXT NOT NULL,
    member_id  TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    correct    INTEGER NOT NULL,
    total      INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (day, member_id)
  );
  -- The Squawk weekly email. One row per issue; sent_at is set when the first batch goes out.
  CREATE TABLE IF NOT EXISTS squawk_issues (
    id           SERIAL PRIMARY KEY,
    subject      TEXT NOT NULL,
    intro        TEXT NOT NULL DEFAULT '',
    sponsor_name TEXT,
    sponsor_text TEXT,
    sponsor_url  TEXT,
    content      TEXT NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at      TIMESTAMPTZ
  );
  -- Who has had each issue, so pressing Send twice (or in batches) never emails anyone twice.
  CREATE TABLE IF NOT EXISTS squawk_sends (
    issue_id  INTEGER NOT NULL REFERENCES squawk_issues (id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (issue_id, member_id)
  );
  -- Simple on/off switches the organiser flips from the admin pages, such as pausing The Daily Hallucination.
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`;

export async function connect({ databaseUrl, localDir } = {}) {
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
    pool.on('error', (err) => console.error('Idle database connection error', err)); // don't crash the process
    return openDb({ query: (text, params) => pool.query(text, params), exec: (text) => pool.query(text), close: () => pool.end() });
  }
  const { PGlite } = await import('@electric-sql/pglite');
  if (localDir) (await import('node:fs')).mkdirSync(localDir, { recursive: true });
  const lite = new PGlite(localDir); // undefined = in memory
  return openDb({ query: (text, params) => lite.query(text, params), exec: (text) => lite.exec(text), close: () => lite.close() });
}

export function openDb(client) {
  // Create or upgrade the tables on first use. If that fails, try again on the next request.
  let ready;
  const ensureSchema = () =>
    (ready ??= withRetry(() => client.exec(SCHEMA)).catch((err) => {
      ready = undefined;
      throw err;
    }));
  const q = async (text, params) => {
    await ensureSchema();
    return (await withRetry(() => client.query(text, params))).rows.map(isoDates);
  };
  const one = async (text, params) => (await q(text, params))[0];

  return {
    // After a LinkedIn, Google or GitHub sign-in. If someone with the same verified email already joined
    // another way, they get that account, so one person never ends up with two.
    async recordLogin(p) {
      if (p.email && p.email_verified) {
        const found = await one('SELECT id FROM members WHERE lower(email) = lower($1) AND email_verified AND id <> $2 ORDER BY created_at LIMIT 1', [p.email, p.id]);
        if (found) {
          await q('UPDATE members SET photo_url = COALESCE(photo_url, $2), github_login = COALESCE(github_login, $3), updated_at = now() WHERE id = $1', [found.id, p.picture ?? null, p.github_login ?? null]);
          return found.id;
        }
      }
      await q(
        `INSERT INTO members (id, name, first_name, last_name, email, email_verified, photo_url, github_login)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, first_name = excluded.first_name, last_name = excluded.last_name,
           email = COALESCE(excluded.email, members.email), email_verified = excluded.email_verified OR members.email_verified,
           photo_url = excluded.photo_url, github_login = COALESCE(excluded.github_login, members.github_login), updated_at = now()`,
        [p.id, p.name || [p.given_name, p.family_name].filter(Boolean).join(' ') || 'Member', p.given_name ?? null, p.family_name ?? null,
          p.email ?? null, Boolean(p.email_verified), p.picture ?? null, p.github_login ?? null],
      );
      return p.id;
    },
    // Members who sign in by email have the id "email:<address>" and type their own name when they join.
    async memberForEmail(email) {
      const found = await one('SELECT id FROM members WHERE lower(email) = $1 AND email_verified ORDER BY created_at LIMIT 1', [email]);
      if (found) return found.id;
      const id = `email:${email}`;
      await q("INSERT INTO members (id, name, email, email_verified) VALUES ($1, '', $2, true) ON CONFLICT DO NOTHING", [id, email]);
      return id;
    },
    // Joining: name (for email members), role, consent, Squawk opt-in, and the growth details the first time.
    async join(id, d) {
      const [first, ...rest] = (d.name || '').split(/\s+/);
      await q(
        `UPDATE members SET role = $2, squawk_optin = $3,
           name = CASE WHEN $4 <> '' THEN $4 ELSE name END,
           first_name = CASE WHEN $4 <> '' THEN $5 ELSE first_name END,
           last_name = CASE WHEN $4 <> '' THEN $6 ELSE last_name END,
           member_number = COALESCE(member_number, (SELECT COALESCE(max(member_number), 0) + 1 FROM members)),
           joined_from = CASE WHEN consent_at IS NULL THEN $7 ELSE joined_from END,
           referred_by = CASE WHEN consent_at IS NULL AND $8 <> id THEN $8 ELSE referred_by END,
           consent_at = COALESCE(consent_at, now()), updated_at = now()
         WHERE id = $1`,
        [id, d.role || null, Boolean(d.squawk_optin), d.name || '', first || null, rest.join(' ') || null, d.joined_from || null, d.referred_by || null],
      );
    },
    get: (id) => one('SELECT * FROM members WHERE id = $1', [id]),
    list: () => q('SELECT * FROM members WHERE consent_at IS NOT NULL ORDER BY created_at DESC'),
    count: async () => (await one('SELECT count(*)::int AS n FROM members WHERE consent_at IS NOT NULL')).n,
    remove: (id) => q('DELETE FROM members WHERE id = $1', [id]),
    setSquawk: (id, on) => q('UPDATE members SET squawk_optin = $2, updated_at = now() WHERE id = $1', [id, Boolean(on)]),

    logins: {
      async create(tokenHash, email, minutes) {
        await q("DELETE FROM login_tokens WHERE created_at < now() - interval '1 day'");
        await q('INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))', [tokenHash, email, minutes]);
      },
      // Links sent in the last `seconds`, to one address or (with no address) to anyone. For spam limits.
      recentCount: async (email, seconds) =>
        (await one('SELECT count(*)::int AS n FROM login_tokens WHERE ($1::text IS NULL OR email = $1) AND created_at > now() - make_interval(secs => $2)', [email, seconds])).n,
      peek: async (tokenHash) => (await one('SELECT email FROM login_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()', [tokenHash]))?.email,
      // Uses the link up and returns its address. Only one caller can ever get it.
      use: async (tokenHash) => (await one('UPDATE login_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email', [tokenHash]))?.email,
    },

    invites: {
      async codeFor(memberId) {
        const m = await one('SELECT invite_code FROM members WHERE id = $1', [memberId]);
        if (!m) return null;
        if (m.invite_code) return m.invite_code;
        for (let i = 0; i < 5; i++) {
          const code = randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').toLowerCase().slice(0, 6);
          try {
            return (await one('UPDATE members SET invite_code = COALESCE(invite_code, $2) WHERE id = $1 RETURNING invite_code', [memberId, code])).invite_code;
          } catch (err) {
            if (err.code !== '23505') throw err; // only retry when the code was already taken
          }
        }
        throw new Error('Could not make an invite code');
      },
      byCode: async (code) =>
        (await one('SELECT id, COALESCE(first_name, name) AS first_name FROM members WHERE invite_code = $1 AND consent_at IS NOT NULL', [String(code).toLowerCase()])) ?? null,
      count: async (memberId) => (await one('SELECT count(*)::int AS n FROM members WHERE referred_by = $1 AND consent_at IS NOT NULL', [memberId])).n,
    },

    settings: {
      get: async (key) => (await one('SELECT value FROM settings WHERE key = $1', [key]))?.value ?? null,
      set: (key, value) => q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, value]),
    },

    stories: {
      // The newest day that has any visible stories.
      async latest() {
        const row = await one('SELECT max(day) AS day FROM stories WHERE NOT hidden');
        return row?.day ? q('SELECT * FROM stories WHERE day = $1 AND NOT hidden ORDER BY position, id', [row.day]) : [];
      },
      recent: (days = 14) =>
        q("SELECT * FROM stories WHERE day >= to_char(now() - make_interval(days => $1), 'YYYY-MM-DD') ORDER BY day DESC, position, id", [days]),
      recentLinks: async (days) =>
        (await q("SELECT source_link FROM stories WHERE day >= to_char(now() - make_interval(days => $1), 'YYYY-MM-DD')", [days])).map((r) => r.source_link),
      countForDay: async (day) => (await one('SELECT count(*)::int AS n FROM stories WHERE day = $1', [day])).n,
      get: (id) => one('SELECT * FROM stories WHERE id = $1', [id]),
      async replaceDay(day, stories) {
        await q('DELETE FROM stories WHERE day = $1', [day]);
        for (const [i, s] of stories.entries()) {
          await q(
            `INSERT INTO stories (day, position, headline, body, agent_id, source, source_title, source_link, source_summary)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [day, i + 1, s.headline, s.body, s.agent_id ?? null, s.source, s.source_title, s.source_link, s.source_summary ?? null],
          );
        }
      },
      update: (id, s) => q('UPDATE stories SET headline = $2, body = $3, agent_id = $4, hidden = false, updated_at = now() WHERE id = $1', [id, s.headline, s.body, s.agent_id ?? null]),
      setHidden: (id, hidden) => q('UPDATE stories SET hidden = $2, updated_at = now() WHERE id = $1', [id, hidden]),
    },

    listings: {
      suggest: (l, memberId) =>
        q('INSERT INTO listings (name, url, description, category, suggested_by) VALUES ($1, $2, $3, $4, $5)', [l.name, l.url, l.description || '', l.category, memberId || null]),
      add: (l) => q("INSERT INTO listings (name, url, description, category, status) VALUES ($1, $2, $3, $4, 'listed')", [l.name, l.url, l.description || '', l.category]),
      listed: () => q("SELECT * FROM listings WHERE status = 'listed' ORDER BY lower(name)"),
      all: () => q("SELECT * FROM listings ORDER BY (status = 'suggested') DESC, created_at DESC"),
      setStatus: (id, status) => q('UPDATE listings SET status = $2 WHERE id = $1', [id, status]),
      remove: (id) => q('DELETE FROM listings WHERE id = $1', [id]),
      recentSuggestions: async (seconds) => (await one("SELECT count(*)::int AS n FROM listings WHERE created_at > now() - make_interval(secs => $1)", [seconds])).n,
    },

    // Agents from other directories (see src/directories.js).
    listed: {
      // Saves a batch from one sync: adds or updates the ones to keep, takes out the rest.
      async save(rows) {
        const cols = ['source', 'source_id', 'name', 'description', 'url', 'endpoint', 'image', 'chain', 'x402', 'tested_id', 'updated_at',
          'maker_key', 'maker_name', 'maker_url', 'first_published_at', 'details'];
        // The same entry can appear twice in one batch (two versions); the last one wins.
        const latest = [...new Map(rows.map((r) => [`${r.source}|${r.source_id}`, r])).values()];
        const keep = latest.filter((r) => r.keep);
        for (let i = 0; i < keep.length; i += 500) {
          const params = [];
          const values = keep.slice(i, i + 500).map((r) => `(${cols.map((c) => {
            params.push(c === 'x402' ? Boolean(r.x402) : c === 'description' ? r.description ?? '' : c === 'details' ? (r.details ? JSON.stringify(r.details) : null) : r[c] ?? null);
            return `$${params.length}`;
          }).join(', ')})`);
          await q(`INSERT INTO listed_agents (${cols.join(', ')}) VALUES ${values.join(', ')}
            ON CONFLICT (source, source_id) DO UPDATE SET ${cols.slice(2).map((c) => (c === 'first_published_at'
              // The earliest date ever seen wins, so a new version doesn't make an old agent look new.
              ? `${c} = LEAST(listed_agents.${c}, excluded.${c})` : `${c} = excluded.${c}`)).join(', ')}, synced_at = now()`, params);
        }
        // One query for all the ones to take out: most registry entries aren't hosted, so there can be hundreds.
        const drop = latest.filter((r) => !r.keep);
        const removed = drop.length
          ? (await q(`DELETE FROM listed_agents WHERE (source, source_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))
              RETURNING source`, [drop.map((r) => r.source), drop.map((r) => r.source_id)])).length
          : 0;
        return { saved: keep.length, removed };
      },
      // Untested agents for the /listed page: search by name or description, optionally from one source.
      async search({ query = '', source = '', limit = 50, offset = 0 } = {}) {
        const where = ['tested_id IS NULL'];
        const params = [];
        if (source) {
          params.push(source);
          where.push(`source = $${params.length}`);
        }
        if (query) {
          params.push(`%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
          where.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
        }
        const from = `FROM listed_agents WHERE ${where.join(' AND ')}`;
        const [rows, total] = await Promise.all([
          q(`SELECT * ${from} ORDER BY updated_at DESC NULLS LAST, lower(name) LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, params),
          one(`SELECT count(*)::int AS n ${from}`, params),
        ]);
        return { rows, total: total.n };
      },
      forTested: (id) => q('SELECT * FROM listed_agents WHERE tested_id = $1 ORDER BY source, source_id', [id]),
      get: (source, sourceId) => one('SELECT * FROM listed_agents WHERE source = $1 AND source_id = $2', [source, sourceId]),
      // Everything one maker has listed, newest first, and the totals their reputation is worked out from.
      byMaker: (key, limit = 100) => q('SELECT * FROM listed_agents WHERE maker_key = $1 ORDER BY updated_at DESC NULLS LAST, lower(name) LIMIT $2', [key, limit]),
      makerStats: (key) => one(`SELECT count(*)::int AS agents, count(DISTINCT source)::int AS sources, min(first_published_at) AS since,
          coalesce(sum((details->>'feedback')::int), 0)::int AS feedback, array_remove(array_agg(DISTINCT tested_id), NULL) AS tested
        FROM listed_agents WHERE maker_key = $1`, [key]),
      makerCounts: async (keys) => (keys.length
        ? Object.fromEntries((await q('SELECT maker_key, count(*)::int AS n FROM listed_agents WHERE maker_key = ANY($1::text[]) GROUP BY maker_key', [keys])).map((r) => [r.maker_key, r.n]))
        : {}),
      counts: () => q('SELECT source, count(*) FILTER (WHERE tested_id IS NULL)::int AS untested, count(*)::int AS total FROM listed_agents GROUP BY source ORDER BY source'),
    },

    game: {
      save: (day, memberId, correct, total) =>
        q('INSERT INTO game_results (day, member_id, correct, total) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [day, memberId, correct, total]),
      // Days played in a row, counting back from today (or yesterday, if today isn't played yet).
      async streak(memberId, today) {
        const days = new Set((await q('SELECT day FROM game_results WHERE member_id = $1 ORDER BY day DESC LIMIT 400', [memberId])).map((r) => r.day));
        const d = new Date(`${today}T00:00:00Z`);
        if (!days.has(today)) d.setUTCDate(d.getUTCDate() - 1);
        let n = 0;
        while (days.has(d.toISOString().slice(0, 10))) n++, d.setUTCDate(d.getUTCDate() - 1);
        return n;
      },
      today: (day, memberId) => one('SELECT correct, total FROM game_results WHERE day = $1 AND member_id = $2', [day, memberId]),
      stats: (day) => one('SELECT count(*)::int AS players, COALESCE(round(avg(correct)::numeric, 1), 0)::float AS avg FROM game_results WHERE day = $1', [day]),
    },

    squawk: {
      optinCount: async () => (await one('SELECT count(*)::int AS n FROM members WHERE consent_at IS NOT NULL AND squawk_optin AND email IS NOT NULL')).n,
      create: async (i) => (await one('INSERT INTO squawk_issues (subject, intro, content) VALUES ($1, $2, $3) RETURNING id', [i.subject, i.intro ?? '', JSON.stringify(i.content ?? {})])).id,
      get: (id) => one('SELECT * FROM squawk_issues WHERE id = $1', [id]),
      list: () => q('SELECT * FROM squawk_issues ORDER BY id DESC'),
      sent: () => q('SELECT * FROM squawk_issues WHERE sent_at IS NOT NULL ORDER BY sent_at DESC'),
      update: (id, i) =>
        q('UPDATE squawk_issues SET subject = $2, intro = $3, sponsor_name = $4, sponsor_text = $5, sponsor_url = $6 WHERE id = $1',
          [id, i.subject, i.intro, i.sponsor_name || null, i.sponsor_text || null, i.sponsor_url || null]),
      setContent: (id, content) => q('UPDATE squawk_issues SET content = $2 WHERE id = $1', [id, JSON.stringify(content)]),
      markStarted: (id) => q('UPDATE squawk_issues SET sent_at = COALESCE(sent_at, now()) WHERE id = $1', [id]),
      delete: (id) => q('DELETE FROM squawk_issues WHERE id = $1 AND sent_at IS NULL', [id]),
      toSend: (id, limit) =>
        q(`SELECT m.id, m.name, m.first_name, m.email FROM members m
           WHERE m.consent_at IS NOT NULL AND m.squawk_optin AND m.email IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM squawk_sends s WHERE s.issue_id = $1 AND s.member_id = m.id)
           ORDER BY m.created_at LIMIT $2`, [id, limit]),
      recordSend: (id, memberId) => q('INSERT INTO squawk_sends (issue_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, memberId]),
      sentCount: async (id) => (await one('SELECT count(*)::int AS n FROM squawk_sends WHERE issue_id = $1', [id])).n,
    },

    // Counts for the organiser's overview. Numbers only.
    async overview() {
      const joined = 'consent_at IS NOT NULL';
      const [m, sources, inviters, roles, players, suggestions] = await Promise.all([
        one(`SELECT count(*) FILTER (WHERE ${joined})::int AS joined,
                    count(*) FILTER (WHERE NOT (${joined}))::int AS started,
                    count(*) FILTER (WHERE ${joined} AND consent_at >= now() - interval '7 days')::int AS joined_7d,
                    count(*) FILTER (WHERE ${joined} AND squawk_optin AND email IS NOT NULL)::int AS squawk
             FROM members`),
        q(`SELECT COALESCE(joined_from, '') AS source, count(*)::int AS n FROM members WHERE ${joined} GROUP BY 1 ORDER BY n DESC LIMIT 20`),
        q(`SELECT i.name, count(*)::int AS n FROM members m JOIN members i ON i.id = m.referred_by
           WHERE m.${joined} GROUP BY i.id, i.name ORDER BY n DESC LIMIT 10`),
        q(`SELECT COALESCE(role, '') AS role, count(*)::int AS n FROM members WHERE ${joined} GROUP BY 1 ORDER BY n DESC`),
        one("SELECT count(DISTINCT member_id)::int AS n FROM game_results WHERE created_at >= now() - interval '7 days'"),
        one("SELECT count(*)::int AS n FROM listings WHERE status = 'suggested'"),
      ]);
      return { members: m, sources, inviters, roles, players7d: players.n, suggestions: suggestions.n };
    },
    close: () => client.close(),
  };
}

// Return timestamps as ISO strings so pages show them consistently.
function isoDates(row) {
  for (const k in row) if (row[k] instanceof Date) row[k] = row[k].toISOString();
  return row;
}

// Neon's free database sleeps when idle, and the first connection after a nap can be reset.
const CONNECTION_ERRORS = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', '57P01', '57P03']);
export async function withRetry(fn, delays = [300, 1000]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = CONNECTION_ERRORS.has(err.code) || /Connection terminated|before secure TLS/i.test(err.message);
      if (!retryable || attempt >= delays.length) throw err;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}
