# ABU-chat — Backend

Instagram comment auto-reply SaaS. This folder contains the backend skeleton.

## What's inside (so far)

- `server/server.js` — Express server entrypoint
- `server/db/` — PostgreSQL pool, schema, migration runner
- `server/lib/` — JWT, AES-GCM token encryption, Meta Graph API wrapper
- `server/routes/` — auth (email+password), Meta OAuth (Instagram connect), webhook (incoming comments), rules CRUD
- `server/middleware/authRequired.js` — JWT cookie/Bearer guard

Frontend (`public/`) is added in step C.

## Local setup

```bash
# 1. Clone & install
npm install

# 2. Copy env template and fill it in
cp .env.example .env
#    - generate JWT_SECRET:        node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    - generate TOKEN_ENC_KEY:     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#    - choose META_WEBHOOK_VERIFY_TOKEN (any long random string)
#    - leave META_APP_ID / META_APP_SECRET empty until your Meta app is created

# 3. PostgreSQL — create a database, then apply the schema
createdb abu_chat
npm run migrate

# 4. Run
npm run dev
# -> http://localhost:3000/healthz
```

## Smoke-test the auth API

```bash
curl -s -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"abu@test.uz","password":"secret123","full_name":"Abu"}' | jq
```

## Setting up the Meta app (after deployment)

1. Create a Facebook app at <https://developers.facebook.com/apps>, type = "Business".
2. Add the **Instagram Graph API** and **Webhooks** products.
3. App settings → Basic → put your domain in *App Domains*.
4. Facebook Login → Settings → set the redirect URI to:
   `https://abu-chat.uz/api/auth/meta/callback`
5. Webhooks → Instagram → set:
   - Callback URL: `https://abu-chat.uz/webhook/meta`
   - Verify token: same value as `META_WEBHOOK_VERIFY_TOKEN` in `.env`
   - Subscribe to: `comments`, `mentions`
6. Submit for **App Review** with these permissions:
   - `instagram_basic`
   - `instagram_manage_comments`
   - `pages_show_list`
   - `pages_read_engagement`

Until App Review passes, only Instagram accounts of *test users* you've added in the Meta dashboard can connect.

## File map

```
abu-chat/
├── package.json
├── .env.example
├── .gitignore
├── README.md
└── server/
    ├── server.js
    ├── db/
    │   ├── index.js          # pg Pool
    │   ├── schema.sql
    │   └── migrate.js
    ├── lib/
    │   ├── jwt.js
    │   ├── crypto.js         # AES-256-GCM for IG tokens
    │   └── meta.js           # Graph API wrapper
    ├── middleware/
    │   └── authRequired.js
    └── routes/
        ├── auth.js           # /api/auth/{register,login,me,logout}
        ├── metaOAuth.js      # /api/auth/meta/{start,callback}, /api/ig-accounts
        ├── rules.js          # /api/rules + /api/rules/{replies,usage}
        └── webhook.js        # /webhook/meta
```
