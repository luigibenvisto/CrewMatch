# CrewMatch

A free platform that matches film crew (camera, grip, electric, sound, art, costume, hair and makeup, production, post) with the productions that need them.

- **Crew** sign up free, forever. They fill in a profile and availability calendar, see the jobs that fit them, accept or decline offers, and confirm finished jobs.
- **Productions** sign up, post a project, pay for it (or use a subscription), see a short ranked list of suitable crew for each position, send offers, and confirm finished jobs.
- **Admin** (you) sees all users and projects, can suspend accounts, and can delete the sample data.

---

## Assumptions I made

You asked me to decide instead of asking. Here is every decision, so you can disagree with any of them.

**Product**
1. **No shared "user" account.** Crew and productions live in separate database tables with separate signup pages, login pages, dashboards and data. One email address can have a crew account and a production account, but they are two separate accounts. You can only be logged in as one at a time.
2. **Productions make offers; crew answer them.** Crew cannot apply to a job. They can click "I'm interested", which shows the production an "Interested" label. That label does not change the ranking.
3. **Productions can only make offers to crew on their suggested list.** They cannot browse or search all crew. This keeps the matching meaningful and protects crew privacy.
4. **Crew email and phone are hidden until the crew member accepts an offer.** After that, both sides see each other's contact details. There is no in-app chat in this version.
5. **Productions see facts, not math.** On the suggested list they see name, roles, city, day rate, skills, gear, bio, recent credits and the number of confirmed CrewMatch jobs. They never see a score, the weights, or anyone's "days since last worked". Crew only see their own clock.
6. **The list is short.** 8 crew per position, and at most 20 matched jobs for a crew member. Both numbers are in the matching config file.
7. **Same-department crew can appear as a fallback.** If you need a 1st AC, a 2nd AC can still show up lower on the list. Someone from a different department never shows up.
8. **Crew must enter their availability to be matched.** If they have not marked any dates as available, they see no jobs and appear on no lists. Their dashboard tells them so. To appear for a job, they must be free for at least 50% of its days. Days already booked through CrewMatch count as busy automatically.
9. **Locations are picked from a list of about 45 film cities** (US, Canada, UK, Ireland, Europe, Australia, New Zealand, South Africa, Mexico). I did not use typed addresses, because turning an address into map coordinates needs a paid service. You can add cities in `src/config/cities.js`.
10. **Distances are in kilometres.** Crew set how far they will travel. Anyone farther away than that is never suggested. Everyone counts as local within 15 km.
11. **Money is in US dollars**, and day rates are whole numbers per day. You can change the currency in `src/config/pricing.js`. There is only one currency for the whole site.
12. **Dates are whole calendar days in UTC.** There are no time zones and no hours.

**"Days since last worked" clock**
13. **The clock is never stored, so nobody can edit it.** It is always calculated from jobs that **both** sides confirmed. It cannot be reset by a crew member alone or by a production alone. A database rule blocks that even if someone gets direct access to the database, and another database rule stops anyone undoing a confirmation once it is made.
14. **The "last worked" date is the job's end date**, or the day of the second confirmation if the job ended early. It can never be a future date.
15. **A job can only be confirmed once it has started.**
16. **Cancellations:** either side can cancel an accepted job until someone has confirmed it. After that it cannot be cancelled. A crew cancellation lowers that crew member's reliability. A production cancellation does not affect the crew member.
17. **New crew with no confirmed jobs** are treated as if they last worked 30 days ago. That is neutral, so they are neither buried nor pushed to the top.
18. **Fake productions:** someone could create a production account just to confirm their own crew account. Two things make this hard. First, a production has to pay before it can make offers. Second, it can only make offers to people the matching suggests. You can also suspend suspicious accounts from the admin page. There is no identity verification in this version.

**Pricing and payments**
19. **Prices are placeholders:** a subscription at $79 per 30 days covering unlimited projects, or a one-off fee per project: $19 (1 to 3 days), $39 (4 to 10), $69 (11 to 30), $129 (31 to 90), $199 (over 90). Project length counts calendar days from the start date to the end date, both included. Change any of these in `src/config/pricing.js`.
20. **A project is a "draft" until it is paid for.** Drafts are invisible to crew and have no suggested crew.
21. **Payments are a stub.** Clicking "Pay" records a payment and opens the project, but **no money moves and no card is asked for**. The page says "Test mode". The stub is one clearly marked file: `src/payments/provider.js`.
22. **Subscriptions do not renew automatically.** Each payment buys 30 days. Buying again before the current period ends adds 30 days on top. Automatic renewal belongs with the real payment provider.

**Technical**
23. **One admin**, whose login comes from environment variables, not from the database.
24. **There is no "forgot password" or email sending yet.** Both need an email service. See "Before real users arrive".
25. **Sample accounts all share one password** and are marked as samples, so you can delete them all with one button.

---

## Why this stack

**Node.js + Express + PostgreSQL, with pages rendered on the server (EJS templates).**

- **Popular and boring, on purpose.** Node and Postgres are among the most widely used tools for small web apps. Any freelance developer you hire later will know them, and every free host supports them.
- **One service to deploy.** The same small program serves the pages and the data. There is no separate frontend to host and no build step. That means fewer moving parts for you to manage.
- **Keeps the matching secret by design.** Pages are built on the server, so ranking numbers never travel to anyone's browser. The tests check this.
- **Postgres enforces the important rules itself.** The "both sides must confirm" rule is a database constraint, not just app code.
- **Few dependencies.** Express (web server), pg (database), express-session plus connect-pg-simple (logins stored in the database), helmet (security headers), zod (input checking), express-rate-limit (slows down password guessing) and EJS (page templates). Password hashing uses scrypt, which is built into Node.

---

## What is where

| Path | What it is |
|---|---|
| `src/config/matching.js` | **Matching weights and thresholds. The one file to edit to tune matching.** |
| `src/config/pricing.js` | Subscription price and per-project fee tiers |
| `src/config/roles.js`, `src/config/cities.js` | Departments, roles and the city list |
| `src/matching/score.js` | The matching algorithm (server side only) |
| `src/services/engagements.js` | Offers, accept/decline, cancel, and the two-sided confirmation clock |
| `src/payments/provider.js` | **Payment stub. Replace this to take real money.** |
| `src/db/migrations/001_initial.sql` | Database structure, including the clock rules |
| `src/db/seed.js` | Invented sample crew and productions |
| `test/` | Automated tests |

### Matching factors

Each factor gives a value from 0 to 1. The final score is a weighted average using the weights in `src/config/matching.js`:

| Factor | Default weight | Notes |
|---|---|---|
| Role and department fit | 30 | Main role 1.0, other role 0.85, same department 0.4, otherwise never shown |
| Availability overlap | 20 | Share of shoot days marked available and not booked. Under 50% means not shown |
| Skills and gear | 15 | Share of the position's wanted skills and gear the person has |
| Location | 10 | Closer is better, inside their travel radius only |
| Rate fit | 10 | Full marks if their range fits the budget. Drops as their minimum goes above the position's maximum |
| Days since last worked | 10 | More days without a confirmed job ranks a little higher (capped at 90 days) |
| Reliability | 5 | Confirmed jobs versus crew cancellations |

---

## Deploying it (step by step)

You will set up two free accounts: **Neon** for the database and **Render** to run the app. Plan for about 30 minutes. You do not need to install anything on your computer.

### Step 1: Merge the code

1. On GitHub, open the pull request I created and read through it.
2. When you are happy with it, click **Merge pull request**. Render will deploy from your main branch.

### Step 2: Create the database on Neon (free, does not expire)

1. Go to <https://neon.tech> and sign up. "Continue with GitHub" is easiest.
2. Click **Create project**. Name it `crewmatch`. Pick the region closest to where most of your users are (for example "AWS US East" or "AWS Europe Frankfurt"). Keep the Postgres version it suggests.
3. On the project dashboard, click **Connect**. You will see a **connection string** starting with `postgresql://` and containing `neon.tech`.
4. Click **Copy**. This is your `DATABASE_URL`. Paste it somewhere safe for a few minutes. **Treat it like a password.**

### Step 3: Create the web service on Render

1. Go to <https://render.com> and sign up with GitHub.
2. Click **New +** and choose **Blueprint**.
3. Choose the `crewmatch` repository. If Render asks for access to it, allow it. Render reads the `render.yaml` file in this repo.
4. Render asks you to fill in three values:
   - `DATABASE_URL`: paste the Neon connection string from Step 2.
   - `ADMIN_EMAIL`: the email you will use to log in to the admin page.
   - `ADMIN_PASSWORD`: a strong password of **at least 12 characters**. Do not reuse one from elsewhere.
5. Click **Apply**. Render builds and starts the app. The first build takes a few minutes. It is finished when the log shows `CrewMatch is running`.
6. Render gives you an address like `https://crewmatch-xxxx.onrender.com`. Open it. You should see the CrewMatch home page.

Render creates `SESSION_SECRET` for you automatically. Sample data loads automatically on the first start, because `SEED_SAMPLE_DATA` is `true`.

### Step 4: Try it

- **Admin:** go to `/admin/login` and use your `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- **Sample production:** go to `/production/login` and log in as `production1@sample.crewmatch.test` with password `sample-password-123`. Logins `production2@` to `production4@` also work.
- **Sample crew:** go to `/crew/login` and log in as `crew1@sample.crewmatch.test` with the same password. Logins up to `crew90@` work.

All sample names, companies and credits are invented.

### Environment variables

These are the app's settings and secrets. On Render, find them under your service, then **Environment**. After changing one, Render restarts the app by itself.

| Name | Required | What it is |
|---|---|---|
| `DATABASE_URL` | Yes | Database connection string from Neon (or another Postgres host) |
| `SESSION_SECRET` | Yes | A long random string used to sign login cookies. Render generates it. If you ever set it yourself, use at least 32 random characters. Changing it logs everyone out. |
| `ADMIN_EMAIL` | For admin | Your admin login email |
| `ADMIN_PASSWORD` | For admin | Your admin password, at least 12 characters. If either admin value is missing, the admin page is switched off. |
| `NODE_ENV` | Yes | Must be `production` when hosted. It turns on secure cookies and refuses to start without a proper secret. |
| `SEED_SAMPLE_DATA` | No | `true` loads sample data, but only when the database has no accounts yet. Set it to `false` before real users arrive. |
| `PAYMENTS_MODE` | No | `stub` (the default). This is the only mode that works today. |
| `DATABASE_SSL_NO_VERIFY` | No | Only set this to `true` if your database host tells you it uses a self-signed certificate. Neon and Render do not need it. |

**Secrets never go in the code.** The `.gitignore` file stops a local `.env` file from being uploaded, and `.env.example` lists the names with no real values.

---

## Connecting your domain, with a /crewmatch path

The reliable setup is to run the app on a **subdomain** and make `yourdomain.com/crewmatch` **redirect** to it:

`yourdomain.com/crewmatch` → `https://crewmatch.yourdomain.com`

### Part A: Put the app on crewmatch.yourdomain.com

1. In Render, open your `crewmatch` service. Go to **Settings**, then **Custom Domains**, then **Add Custom Domain**.
2. Type `crewmatch.yourdomain.com`, using your real domain, and save. Render shows a value like `crewmatch-xxxx.onrender.com`.
3. Log in to the company where you manage your domain's DNS. That is usually where you bought the domain (GoDaddy, Namecheap, Squarespace Domains, Google/Squarespace, Cloudflare, Aruba, Register.it...). Find **DNS settings** or **DNS records**.
4. Add a new record:
   - **Type:** `CNAME`
   - **Name / Host:** `crewmatch`
   - **Value / Target / Points to:** the `...onrender.com` address Render showed you
   - **TTL:** leave the default
5. Back in Render, click **Verify**. It can take from a few minutes to a few hours. Render then sets up the secure padlock (HTTPS) for free.

### Part B: Make yourdomain.com/crewmatch redirect there

How you do this depends on what currently runs at `yourdomain.com`:

- **A Squarespace site:** go to **Settings**, then **Developer tools** (or **Advanced**), then **URL Mappings**. Add the line `/crewmatch -> https://crewmatch.yourdomain.com 301`.
- **A Wix site:** go to **Settings**, then **SEO**, then **URL Redirect Manager**. Redirect `/crewmatch` to `https://crewmatch.yourdomain.com`.
- **A WordPress site:** install the free "Redirection" plugin. Add a redirect from `/crewmatch` to `https://crewmatch.yourdomain.com`.
- **DNS on Cloudflare:** go to **Rules**, then **Redirect Rules**, then **Create rule**. Set it so that when "URI Path equals `/crewmatch`", it does a "Static" redirect to `https://crewmatch.yourdomain.com` with status 301.
- **A Netlify site:** add the line `/crewmatch  https://crewmatch.yourdomain.com  301` to its `_redirects` file.
- **Nothing runs at yourdomain.com yet:** the simplest option is to point the whole domain at the app. In Render's Custom Domains, also add `yourdomain.com`, and follow the DNS records Render gives you for it. The app already redirects `/crewmatch` to its home page, so `yourdomain.com/crewmatch` works.

Test it: open `yourdomain.com/crewmatch` in a private browser window. You should land on CrewMatch.

---

## Free tier limits (checked when this was written; providers change these, so check their pricing pages)

- **Render free web service goes to sleep** after about 15 minutes with no visitors. The next visitor waits about a minute while it wakes up. That is fine for testing and not fine for real users.
- **Render's free database is deleted after 30 days.** That is why these steps use Neon instead. Do not create a Render free database for CrewMatch.
- **Neon free plan:** about 0.5 GB of storage, which is plenty for thousands of profiles, and a monthly compute allowance. The database pauses when idle and wakes up in about a second. It does not expire.
- **Railway** has no permanent free plan. It gives trial credit, then costs about $5 per month. It works fine if you prefer it: create a Postgres database there and a service from this repo, and set the same environment variables.
- **Sample data uses one known password.** Delete it before real users arrive.

---

## Before real users arrive: what to change

In rough order of importance:

1. **Delete the sample data.** In `/admin`, click **Delete all sample data**. Then set `SEED_SAMPLE_DATA` to `false` on Render.
2. **Pay for an always-on web service.** Render "Starter" is about $7 per month, so the site never sleeps.
3. **Move the database to a paid plan with backups.** Neon "Launch" or Render's paid Postgres. Free plans have little or no backup history.
4. **Turn on real payments** (see below).
5. **Add email sending** (for example Postmark, Resend or SendGrid). This enables "forgot password", email verification and notifications such as "you have a new offer". None of these exist yet.
6. **Add Terms of Service and a Privacy Policy.** You store personal data (names, emails, phones, locations). If you have EU or UK users, GDPR applies. Get legal advice.
7. **Review the prices** in `src/config/pricing.js` and the **matching weights** in `src/config/matching.js` once you see real usage.
8. **Add more cities** to `src/config/cities.js`, or add a geocoding service later.
9. **Set up monitoring.** A free uptime checker (for example UptimeRobot) pointed at `https://your-app/healthz` tells you if the site goes down.

### Turning on real payments

The rest of the app only talks to `src/payments/provider.js`. To use Stripe, a developer would:

1. Create a Stripe account and get its secret key. Add it as a new environment variable, `STRIPE_SECRET_KEY`. Never put it in the code.
2. In `provider.js`, replace the stub so that it creates a Stripe Checkout session, sends the production to Stripe's payment page, and returns status `pending`.
3. Add a Stripe "webhook" page. When Stripe confirms the payment, it marks the payment `succeeded` and opens the project (or starts the subscription). Stripe subscriptions can also handle automatic renewal.
4. Set `PAYMENTS_MODE=stripe`.

The data model is already in place: payments, subscriptions, and per-project billing status and fee.

---

## Running it on your own computer (optional, for a developer)

```bash
npm install
```

```bash
cp .env.example .env
```

Then edit `.env`. You need a local Postgres with a database whose address matches `DATABASE_URL`.

```bash
npm run seed
```

```bash
npm run dev
```

Open <http://localhost:3000>. The `dev`, `seed` and `migrate` commands read `.env` automatically.

### Tests

```bash
npm test
```

There are 44 tests:

- **Matching algorithm:** each factor, the hard filters, that the weights in the config change the order, and that no score ever reaches what productions see.
- **Confirmation clock:** one side alone never resets it, even after repeated confirmations, a stranger or another production cannot confirm, direct database edits are refused, confirmations cannot be undone, and two confirmations arriving at the same instant are handled.
- **Pricing.**
- **End to end through the website:** separate logins, form security, input checks, and the full flow from posting a project to both sides confirming.

The database tests need Postgres. They use `TEST_DATABASE_URL`, which defaults to a local `crewmatch_test` database, and they **wipe** that database. GitHub runs all tests automatically on every push (see the "Actions" tab).
