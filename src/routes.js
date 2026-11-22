import { compareRoutes } from './compare.js';
import express from 'express';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readSession, writeSession, renewSession, clearSession, parseCookies } from './session.js';
import * as linkedin from './linkedin.js';
import * as oauth from './oauth.js';
import * as views from './views.js';
import { adminHome, adminNewsPage, adminListingsPage } from './admin-views.js';
import { allAgents, agentById, peckingOrder, stats, CATEGORIES, SYNCED_AT } from './agents.js';
import { ARTICLES, articleBySlug } from './articles.js';
import { roundsFor, gameNumber, ROUNDS_PER_DAY } from './game.js';
import { cachedHeadlines } from './news.js';
import { claudeWriter, runDaily, regenerateStory, today } from './hallucination.js';
import { emailSender } from './email.js';
import { squawkRoutes } from './squawk.js';
import { directoryRoutes } from './directory-routes.js';
import { feedRoutes } from './feed.js';
import { listedOn } from './directories.js';
import { listedOnBlock, testedDetailsBlock } from './directory-views.js';
import { reputationFor } from './directory-routes.js';
import { testedDetails, factsFor } from './makers.js';
import { reviewRoutes, reviewSection, makerRatings } from './reviews.js';
import { digestRoutes } from './digest.js';
import { reviewsBlock, ratingFact, noticeFor } from './review-views.js';
import { agentReportRoutes, reportSection } from './agent-reports.js';
import { reportNoticeFor } from './agent-report-views.js';
import { claimRoutes, claimInfo, claimsForMember } from './claims.js';
import { claimTag, memberClaimsBlock } from './claim-views.js';

// A complete app around the routes, used by tests.
export function createApp(options) {
  return express().set('trust proxy', 1).use(createRoutes(options));
}

// LinkedIn's profile in the same shape as Google's and GitHub's.
const linkedInProfile = async (opts) => {
  const p = await linkedin.fetchProfile(opts);
  return { id: `linkedin:${p.sub}`, name: p.name, given_name: p.given_name, family_name: p.family_name, email: p.email, email_verified: Boolean(p.email_verified), picture: p.picture };
};

export function createRoutes({
  db, config, lookup,
  fetchProfile = (provider, opts) => (provider === 'linkedin' ? linkedInProfile(opts) : oauth.fetchProfile(provider, opts)),
  getHeadlines = cachedHeadlines(),
  writeStories = claudeWriter({ apiKey: config.anthropicApiKey }),
  sendEmail = emailSender({ brevoKey: config.brevoApiKey, resendKey: config.resendApiKey, from: config.emailFrom, log: config.logEmails }),
  now = () => new Date(),
  fetchFn = fetch,
}) {
  const app = express.Router();
  const secure = config.baseUrl.startsWith('https://');
  const providers = ['linkedin', 'google', 'github'].filter((p) => config[p]?.clientId && config[p]?.clientSecret);
  const signInOptions = () => (config.devFakeLogin ? ['github'] : providers);
  const agentsBrief = allAgents().map((a) => ({ id: a.id, name: a.name, description: a.description }));
  const agentFor = (id) => (id ? agentById(id) : null);

  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use(express.json({ limit: '2kb' }));
  app.use((req, res, next) => {
    req.session = readSession(req, config.sessionSecret);
    renewSession(req, res, config.sessionSecret, secure);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    views.pageContext.run({ signedIn: Boolean(req.session.uid), baseUrl: config.baseUrl, graderUrl: config.graderUrl, path: req.path }, next);
  });

  // Forms that change something must come from this site. (The weekly email's one-click unsubscribe sends no origin.)
  app.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const origin = req.get('origin');
    if (!origin || origin === 'null') return next();
    try {
      if (new URL(origin).host === req.get('host')) return next();
    } catch {}
    res.status(403).send('Forbidden');
  });

  // Growth tracking. A link tagged ?from=x-thread remembers that tag (first visit wins, for 30 days), so the admin
  // page can show which posts bring people in. Only the tag is kept, and only on the member's record once they join.
  const TRACK_DAYS = 30;
  const trackCookie = (res, name, value) => res.cookie(name, value, { httpOnly: true, sameSite: 'lax', secure, maxAge: TRACK_DAYS * 864e5, path: '/' });
  const cleanTag = (v) => (typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/i.test(v) ? v.toLowerCase() : null);
  app.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    req.track = { from: cleanTag(cookies.ap_from), ref: cleanTag(cookies.ap_ref) };
    const tag = cleanTag(req.query.from);
    if (tag && !req.track.from && req.method === 'GET') {
      trackCookie(res, 'ap_from', tag);
      req.track.from = tag;
    }
    next();
  });

  app.get('/i/:code', async (req, res) => {
    const code = cleanTag(req.params.code);
    if (code && (await db.invites.byCode(code))) {
      trackCookie(res, 'ap_ref', code);
      if (!req.track.from) trackCookie(res, 'ap_from', 'invite');
    }
    res.redirect(302, '/');
  });

  const memberOf = async (req) => (req.session.uid && (await db.get(req.session.uid))) || null;
  const signedIn = async (req, res, next) => {
    req.member = await memberOf(req);
    if (!req.member) return res.redirect('/signin');
    next();
  };
  const joined = (req, res, next) => (req.member.consent_at ? next() : res.redirect('/join'));

  // ----- Public pages -----

  const pickCategory = (v) => (CATEGORIES.some((c) => c.id === v) ? v : '');

  app.get('/', async (req, res) => {
    const member = await memberOf(req);
    const inviter = !member && req.track.ref ? await db.invites.byCode(req.track.ref) : null;
    res.send(views.homePage({
      member, memberCount: await db.count(), stats: { ...stats(), top3: peckingOrder().slice(0, 3) },
      rows: peckingOrder(pickCategory(req.query.category)), category: pickCategory(req.query.category),
      honestyFails: allAgents().filter((a) => a.honesty === 'failed'), makers: agentById('cheap-first'), stories: await db.stories.latest(),
      articles: ARTICLES.slice(0, 3), gameNo: gameNumber(today()), providers: signInOptions(), emailLogin: Boolean(sendEmail), inviter,
      error: req.query.error === 'cancelled' ? 'Sign-in was cancelled. You can try again.' : null,
    }));
  });

  const directory = async (req, res, extra = {}, status = 200) => {
    const category = pickCategory(req.query.category);
    const agents = allAgents().filter((a) => !category || a.category === category);
    const listings = (await db.listings.listed()).filter((l) => !category || l.category === category);
    const makerOf = Object.fromEntries(agents.map((a) => [a.id, factsFor(a.id).maker?.key]));
    const [ratings, byMaker] = await Promise.all([db.reviews.summaries(agents.map((a) => a.id)), makerRatings(db, Object.values(makerOf))]);
    const makerRatingsById = Object.fromEntries(agents.map((a) => [a.id, byMaker[makerOf[a.id]]]));
    res.status(status).send(views.directoryPage({ agents, listings, ratings, makerRatings: makerRatingsById, category, signedIn: Boolean(req.session.uid), ...extra }));
  };
  app.get('/agents', (req, res) => directory(req, res, { notice: req.query.thanks ? "Thanks! Polly will take a look at it." : null }));

  app.post('/agents/suggest', signedIn, joined, async (req, res) => {
    const clean = (k, max) => String(req.body[k] ?? '').trim().slice(0, max);
    const l = { name: clean('name', 80), url: clean('url', 300), description: clean('description', 200), category: pickCategory(req.body.category) || 'assistants' };
    if (!l.name || !/^https?:\/\/\S+$/i.test(l.url)) return directory(req, res, { error: 'Please give the agent a name and a link starting with https://' }, 400);
    if ((await db.listings.recentSuggestions(3600)) >= 30) return directory(req, res, { error: 'Lots of suggestions just now. Please try again in an hour.' }, 429);
    await db.listings.suggest(l, req.member.id);
    res.redirect(303, '/agents?thanks=1#suggest');
  });

  app.get('/agents/:id', async (req, res) => {
    const agent = agentById(req.params.id);
    if (!agent) return res.status(404).send(views.pageNotFound());
    const order = peckingOrder();
    const rows = await db.listed.forTested(agent.id);
    const listed = listedOnBlock(listedOn(agent, rows));
    const d = testedDetails(agent, rows);
    const member = await memberOf(req);
    const who = { ref: agent.id, name: agent.name, makerKey: d.makerKey };
    const [reviews, report] = await Promise.all([
      reviewSection(db, { agent: who, member, notice: noticeFor(req.query.review) }),
      reportSection(db, { agent: who, member, notice: reportNoticeFor(req.query.report) }),
    ]);
    const maker = await reputationFor(db, d.makerKey);
    const makerRating = maker ? (await db.reviews.makerSummaries([d.makerKey], { [d.makerKey]: maker.tested.map((a) => a.id) }))[d.makerKey] : null;
    const details = testedDetailsBlock(d, { gradedAt: agent.gradedAt, rows, rep: maker?.rep, report, makerRating });
    // Signed-in members see their own review form, so their copy of the page is never cached for others.
    res.set('Cache-Control', req.session.uid ? 'private, no-store' : 'public, s-maxage=600, stale-while-revalidate=3600');
    res.send(views.agentPage({ agent, place: order.find((a) => a.id === agent.id).place, total: order.length, listed, details,
      rating: ratingFact(reviews.summary), reviews: reviewsBlock(reviews, { tested: true }), claim: claimTag(await claimInfo(db, agent.id)) }));
  });

  app.get('/pecking-order', (req, res) => {
    const category = pickCategory(req.query.category);
    res.send(views.peckingOrderPage({ rows: peckingOrder(category || undefined), category }));
  });

  app.get('/get-polly-tested', (req, res) => res.send(views.getTestedPage({ agent: String(req.query.agent ?? '').slice(0, 300) })));

  app.get('/news', async (req, res) => {
    // The past week of stories, newest day first; the page groups them by day.
    const stories = (await db.stories.recent(7)).filter((s) => !s.hidden);
    if (stories.length) {
      res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return res.send(views.newsPage({ stories, agentFor }));
    }
    const headlines = await Promise.race([getHeadlines().catch(() => []), new Promise((r) => setTimeout(r, 2500, []))]);
    res.send(views.newsPage({ stories, agentFor, headlines }));
  });

  app.get('/news/:id', async (req, res) => {
    const story = /^\d+$/.test(req.params.id) ? await db.stories.get(Number(req.params.id)) : null;
    if (!story || story.hidden) return res.status(404).send(views.errorPage("We couldn't find that story."));
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.send(views.storyPage({ story, agent: agentFor(story.agent_id) }));
  });

  app.get('/game', async (req, res) => {
    const day = today();
    const member = await memberOf(req);
    const played = member ? await db.game.today(day, member.id) : null;
    res.set('Cache-Control', 'private, no-store');
    res.send(views.gamePage({
      rounds: roundsFor(day), gameNo: gameNumber(day), played, signedIn: Boolean(member?.consent_at),
      streak: member ? await db.game.streak(member.id, day) : 0, stats: await db.game.stats(day),
    }));
  });

  // The game page posts the score when a signed-in member finishes. Only today's game, once.
  app.post('/api/game', async (req, res) => {
    const member = await memberOf(req);
    if (!member?.consent_at) return res.status(401).json({ error: 'Join to keep a streak.' });
    const correct = Number(req.body?.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct > ROUNDS_PER_DAY) return res.status(400).json({ error: 'Bad score' });
    const day = today();
    await db.game.save(day, member.id, correct, ROUNDS_PER_DAY);
    res.json({ streak: await db.game.streak(member.id, day) });
  });

  app.get('/articles', (req, res) => res.send(views.articlesPage({ articles: ARTICLES })));
  app.get('/articles/:slug', (req, res) => {
    const article = articleBySlug(req.params.slug);
    if (!article) return res.status(404).send(views.pageNotFound());
    res.send(views.articlePage({ article, more: ARTICLES.filter((x) => x !== article).slice(0, 3) }));
  });

  app.get('/privacy', (req, res) => res.send(views.privacyPage({ contactEmail: config.contactEmail })));

  // ----- Signing in -----

  // Signing in and signing up are the same flow (a new person gets an account); only the words differ.
  for (const [path, mode] of [['/signin', 'signin'], ['/signup', 'signup']]) {
    app.get(path, async (req, res) => {
      const member = await memberOf(req);
      if (member) return res.redirect(member.consent_at ? '/me' : '/join');
      res.send(views.signInPage({ providers: signInOptions(), emailLogin: Boolean(sendEmail), mode }));
    });
  }

  const afterLogin = async (res, uid) => {
    writeSession(res, { uid }, config.sessionSecret, secure);
    const member = await db.get(uid);
    res.redirect(303, member.consent_at ? '/me' : '/join');
  };

  app.get('/auth/:provider', async (req, res, next) => {
    const { provider } = req.params;
    if (!['linkedin', 'google', 'github'].includes(provider)) return next();
    if (config.devFakeLogin) {
      const uid = await db.recordLogin({ id: 'github:dev', name: 'Test Member', given_name: 'Test', family_name: 'Member', email: 'test@example.com', email_verified: true, github_login: 'test' });
      return afterLogin(res, uid);
    }
    const keys = config[provider];
    if (!keys?.clientId) return res.status(500).send(views.errorPage('That sign-in option is not set up yet.'));
    const state = randomBytes(16).toString('hex');
    writeSession(res, { state, provider }, config.sessionSecret, secure, 15 * 60);
    const redirectUri = `${config.baseUrl}/auth/${provider}/callback`;
    res.redirect(provider === 'linkedin' ? linkedin.authorizeUrl({ clientId: keys.clientId, redirectUri, state }) : oauth.authorizeUrl(provider, { clientId: keys.clientId, redirectUri, state }));
  });

  app.get('/auth/:provider/callback', async (req, res, next) => {
    const { provider } = req.params;
    if (!['linkedin', 'google', 'github'].includes(provider)) return next();
    const { code, state, error } = req.query;
    if (error) return res.redirect('/?error=cancelled');
    if (!code || !state || state !== req.session.state || provider !== req.session.provider) {
      return res.status(400).send(views.errorPage('Your sign-in link expired or was invalid. Please try again.'));
    }
    try {
      const keys = config[provider];
      const profile = await fetchProfile(provider, { code, clientId: keys.clientId, clientSecret: keys.clientSecret, redirectUri: `${config.baseUrl}/auth/${provider}/callback` });
      if (!profile?.id) throw new Error(`${provider} did not return an id`);
      await afterLogin(res, await db.recordLogin(profile));
    } catch (err) {
      console.error(err);
      res.status(502).send(views.errorPage('We could not finish signing you in. Please try again in a moment.'));
    }
  });

  // Sign in by email. We email a one-time link; only its hash is stored.
  const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
  const emailPage = (res, opts = {}, status = 200) => res.status(status).send(views.emailSignInPage(opts));

  app.get('/auth/email', (req, res) => (sendEmail ? emailPage(res) : res.redirect('/signin')));

  app.post('/auth/email', async (req, res) => {
    if (!sendEmail) return res.redirect(303, '/signin');
    const email = String(req.body.email ?? '').trim().toLowerCase().slice(0, 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return emailPage(res, { email, error: 'Please enter a valid email address.' }, 400);
    // Stop the form being used to flood someone's inbox, or to run up the email bill.
    if ((await db.logins.recentCount(email, 15 * 60)) >= 3 || (await db.logins.recentCount(null, 60 * 60)) >= 200) {
      return emailPage(res, { email, error: "We've already sent a few links to that address. Please check your inbox and spam folder, or try again in 15 minutes." }, 429);
    }
    const token = randomBytes(32).toString('base64url');
    await db.logins.create(hashToken(token), email, views.LINK_MINUTES);
    try {
      await sendEmail(views.signInEmail({ to: email, link: `${config.baseUrl}/auth/email/verify?token=${token}` }));
    } catch (err) {
      console.error(err);
      return emailPage(res, { email, error: "We couldn't send the email just now. Please try again in a minute." }, 502);
    }
    emailPage(res, { email, sent: true });
  });

  // Opening the link shows a button rather than signing in straight away, so email scanners can't use it up.
  app.get('/auth/email/verify', async (req, res) => {
    const token = String(req.query.token ?? '');
    const email = token && (await db.logins.peek(hashToken(token)));
    if (!email) return emailPage(res, { expired: true }, 400);
    res.send(views.emailConfirmPage({ email, token }));
  });

  app.post('/auth/email/verify', async (req, res) => {
    const email = await db.logins.use(hashToken(req.body.token ?? ''));
    if (!email) return emailPage(res, { expired: true }, 400);
    await afterLogin(res, await db.memberForEmail(email));
  });

  app.get('/join', signedIn, (req, res) => res.send(views.joinPage({ member: req.member })));

  app.post('/join', signedIn, async (req, res) => {
    const needsName = req.member.id.startsWith('email:');
    const name = String(req.body.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const role = views.ROLES.some(([v]) => v === req.body.role) ? req.body.role : null;
    let error = null;
    if (needsName && !name) error = 'Please tell us your name.';
    else if (req.body.consent !== 'yes') error = 'Please tick the box to agree, so we can keep you as a member.';
    if (error) return res.status(400).send(views.joinPage({ member: { ...req.member, name: name || req.member.name, role }, error }));
    const inviter = req.track.ref ? await db.invites.byCode(req.track.ref) : null;
    await db.join(req.member.id, {
      name: needsName ? name : '', role, squawk_optin: req.body.squawk === 'yes' && Boolean(req.member.email),
      joined_from: req.track.from, referred_by: inviter?.id,
    });
    res.redirect(303, '/me');
  });

  app.get('/me', signedIn, joined, async (req, res) => {
    const [inviteCode, invited, streak, claims] = await Promise.all([db.invites.codeFor(req.member.id), db.invites.count(req.member.id), db.game.streak(req.member.id, today()), claimsForMember(db, req.member)]);
    res.set('Cache-Control', 'private, no-store');
    res.send(views.mePage({ member: req.member, inviteCode, invited, streak, claims: memberClaimsBlock(claims) }));
  });

  app.post('/remove', signedIn, async (req, res) => {
    await db.remove(req.member.id);
    clearSession(res);
    res.send(views.removedPage());
  });

  app.post('/logout', (req, res) => {
    clearSession(res);
    res.redirect(303, '/');
  });

  // ----- Organiser -----

  const adminOnly = (req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    const password = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : '';
    const hash = (s) => createHash('sha256').update(s).digest();
    if (config.adminPassword && password && timingSafeEqual(hash(password), hash(config.adminPassword))) return next();
    res.set('WWW-Authenticate', 'Basic realm="Agent Parrot admin"').status(401).send('Admin password required.');
  };

  app.use(squawkRoutes({ db, config, adminOnly, sendEmail, now }));
  app.use(directoryRoutes({ db, config, adminOnly, fetchFn, lookup }));
  app.use(feedRoutes({ config }));
  app.use(compareRoutes({ db }));
  app.use(reviewRoutes({ db, adminOnly }));
  app.use(agentReportRoutes({ db, adminOnly }));
  app.use(claimRoutes({ db, config, adminOnly, fetchFn, lookup }));
  app.use(digestRoutes({ db, config, adminOnly, now }));

  app.get('/admin', adminOnly, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.send(adminHome({ o: await db.overview(), members: await db.list(), syncedAt: SYNCED_AT }));
  });

  // Vercel Cron calls this every morning (see vercel.json). It does nothing if today's stories already exist,
  // so a stray call can't run up the Claude bill. While paused at /admin/news, it writes nothing.
  app.get('/api/cron/hallucination', async (req, res) => {
    if (config.cronSecret && req.headers.authorization !== `Bearer ${config.cronSecret}`) return res.status(401).json({ error: 'unauthorised' });
    try {
      // Starts paused, so the organiser can read the first stories before the daily run goes live.
      if ((await db.settings.get('news_paused')) !== 'no') return res.json({ paused: true, created: 0 });
      res.json(await runDaily({ db, getHeadlines, agents: agentsBrief, write: writeStories }));
    } catch (err) {
      console.error('Daily Hallucination failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  const newsAdmin = async (res, { notice, error, status = 200 } = {}) =>
    res.status(status).send(adminNewsPage({ stories: await db.stories.recent(), notice, error, hasKey: Boolean(writeStories),
      paused: (await db.settings.get('news_paused')) !== 'no', agentFor }));

  app.get('/admin/news', adminOnly, (req, res) => newsAdmin(res));
  app.post('/admin/news/pause', adminOnly, async (req, res) => (await db.settings.set('news_paused', 'yes'), res.redirect(303, '/admin/news')));
  app.post('/admin/news/resume', adminOnly, async (req, res) => (await db.settings.set('news_paused', 'no'), res.redirect(303, '/admin/news')));

  app.post('/admin/news/generate', adminOnly, async (req, res) => {
    try {
      const { created } = await runDaily({ db, getHeadlines, agents: agentsBrief, write: writeStories, force: true });
      await newsAdmin(res, { notice: `Wrote ${created} new ${created === 1 ? 'story' : 'stories'} for today.` });
    } catch (err) {
      console.error(err);
      await newsAdmin(res, { error: err.message, status: 502 });
    }
  });

  app.post('/admin/news/:id/:action', adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const { action } = req.params;
    if (!Number.isInteger(id) || !['hide', 'show', 'regenerate'].includes(action)) return res.status(404).send('Not found.');
    if (action !== 'regenerate') {
      await db.stories.setHidden(id, action === 'hide');
      return res.redirect(303, `/admin/news#story-${id}`);
    }
    try {
      await regenerateStory({ db, id, agents: agentsBrief, write: writeStories });
      res.redirect(303, `/admin/news#story-${id}`);
    } catch (err) {
      console.error(err);
      await newsAdmin(res, { error: err.message, status: 502 });
    }
  });

  app.get('/admin/listings', adminOnly, async (req, res) => res.send(adminListingsPage({ listings: await db.listings.all() })));
  app.post('/admin/listings', adminOnly, async (req, res) => {
    const clean = (k, max) => String(req.body[k] ?? '').trim().slice(0, max);
    const l = { name: clean('name', 80), url: clean('url', 300), description: clean('description', 200), category: pickCategory(req.body.category) || 'assistants' };
    if (!l.name || !/^https?:\/\/\S+$/i.test(l.url)) return res.status(400).send(adminListingsPage({ listings: await db.listings.all(), draft: l, error: 'Please give a name and a link starting with https://' }));
    await db.listings.add(l);
    res.redirect(303, '/admin/listings');
  });
  app.post('/admin/listings/:id/:action', adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isInteger(id) && req.params.action === 'list') await db.listings.setStatus(id, 'listed');
    if (Number.isInteger(id) && req.params.action === 'delete') await db.listings.remove(id);
    res.redirect(303, '/admin/listings');
  });

  // ----- Things search engines and browsers ask for -----
  const publicDir = fileURLToPath(new URL('../public', import.meta.url));
  app.get('/favicon.ico', (req, res) => res.sendFile(`${publicDir}/favicon-48.png`, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } }));

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(['User-agent: *',
      ...['/admin', '/auth', '/api', '/join', '/me', '/signin', '/signup', '/logout', '/remove', '/claim'].map((p) => `Disallow: ${p}`),
      '', `Sitemap: ${config.baseUrl}/sitemap.xml`, ''].join('\n'));
  });

  app.get('/sitemap.xml', async (req, res) => {
    const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const urls = ['/', '/agents', '/listed', '/pecking-order', '/news', '/game', '/articles', '/get-polly-tested', '/feed', '/squawk', '/digest', '/privacy'].map((p) => ({ loc: p }));
    for (const a of allAgents()) urls.push({ loc: `/agents/${a.id}`, lastmod: a.gradedAt.slice(0, 10) });
    for (const x of ARTICLES) urls.push({ loc: `/articles/${x.slug}`, lastmod: x.date });
    for (const w of await db.digest.weeks()) urls.push({ loc: `/digest/${w}` });
    for (const s of (await db.stories.recent(60)).filter((s) => !s.hidden)) urls.push({ loc: `/news/${Number(s.id)}`, lastmod: s.day });
    res.set('Cache-Control', 'public, s-maxage=3600').type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) =>
        `  <url><loc>${xmlEsc(config.baseUrl + u.loc)}</loc>${u.lastmod ? `<lastmod>${xmlEsc(u.lastmod)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
  });

  app.use((req, res) => res.status(404).send(views.pageNotFound()));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).send(views.errorPage(status >= 500 ? 'Something went wrong on our side. Please try again in a minute.' : "That request couldn't be processed."));
  });

  return app;
}
