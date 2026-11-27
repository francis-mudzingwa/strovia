# Strovia

**Stroke recovery monitoring for care teams.** A shared, private web app where caregivers, family and administrators follow a stroke
survivor's care plan, daily symptoms and recovery. Fixed safety rules decide when something needs attention; AI only explains why.

[**Try the live demo (one click, no account)**](https://strovia-demo.netlify.app/) · [**Read the capstone portfolio**](https://strovia-app.netlify.app/portfolio/)

> Capstone project, MS in Information Technology (Healthcare Technologies), Clark University, Fall 2026.
> Strovia is a prototype. It uses **sample data only**, has **not** been assessed for HIPAA compliance, and is **not** a medical device.

## What it does

- **Three roles.** Caregivers record the day, family proxies follow recovery and can step in, administrators write care plans, schedule shifts and see an audit trail.
- **Daily check-in** using the B.E. F.A.S.T. stroke signs, plus readings, medicines, exercises, meals and bowel log.
- **Safety rules, not AI, decide alerts.** Amber and red states, with push and email alerts that carry no patient details.
- **AI explanations.** After a check-in, Claude writes a short plain-language note. It can never raise or hide an alert, and no patient name is ever sent to it.
- **Time and shift aware.** Staff can record only while on shift; some tasks open at set Eastern times.
- **Training module** with quizzes and certificates, and an in-app "How it works" guide.
- **Security in the database.** Row-level security and triggers enforce who can see and change what; an audit trail records sign-ins and changes.

## How it is built

| Layer | Technology |
|---|---|
| Front end | React, Vite, Recharts, lucide-react (installable web app) |
| Back end | Supabase: Auth, Postgres with row-level security and triggers, Edge Functions (TypeScript), scheduled jobs |
| Hosting | Netlify |
| AI in the product | Anthropic Claude, for plain-language explanations only |
| How it was built | AI-assisted development (Claude Code), directed and tested by the author |

Key decisions: rules decide and AI explains; access is enforced in the database, not just on screen; no patient details in notifications.

## Run it locally

1. Create a Supabase project and apply the SQL files in `supabase/migrations` in order.
2. Deploy the functions in `supabase/functions` and set their secrets in Supabase (AI key, email credentials, web-push keys).
3. Copy `.env.example` to `.env` and add your project's URL and public key.
4. `npm install`, then `npm run dev`.

## The one-click demo

The demo is a **separate copy**: the same app built with `VITE_DEMO=true`, pointed at its own throw-away Supabase project that holds only
made-up staff and sample patients. Everything for it lives in `supabase/demo/`:

- `seed_demo.sql` fills and, every night, rebuilds the sample data (`demo_reset()`).
- `functions/demo-login` signs in to the four fixed demo accounts. It refuses to run unless the project has `DEMO_MODE=true`.
- `functions/analyze-checkin` is a rule-based stand-in for the AI note, so the demo never calls an AI service.

The real app is built without `VITE_DEMO`, so none of this shows there.

## Notes

- This copy leaves out private configuration and real account details. Names and Company IDs in the sample SQL are placeholders.
- AI use is disclosed in the portfolio: Claude Code wrote and edited most of the code under the author's direction; the author tested and released every change.

(c) The author. Student capstone, all rights reserved unless a license is added.
