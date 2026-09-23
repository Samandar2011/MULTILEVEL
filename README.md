# CEFR MASTER

Original Uzbek-language CEFR mock-exam platform prototype with a responsive student experience and protected admin area.

## Start

```powershell
npm start
```

Open `http://localhost:3000`.

## Deploy online with Render

1. Push this project to a GitHub repository.
2. In Render, choose **New > Blueprint** and select the repository.
3. Render will read `render.yaml`, create the Node web service and attach a persistent disk for `data.json` and audio uploads.
4. Open the generated `https://...onrender.com` URL.

The free plan may sleep when idle. The included `render.yaml` uses a small persistent disk, so use a paid Render plan if the disk is required in production.

| Account | Login | Password |
|---|---|---|
| Student | `student@cefrmaster.uz` | `Student@2026` |
| Admin | `admin@cefrmaster.uz` | `Admin@2026` |

The server creates `data.json` on first run. It holds local development data and is intentionally excluded from source control. Passwords are salted `scrypt` hashes.

## Included working flows

- Registration, login, server-side sessions, logout, role-gated admin APIs
- Test catalogue, server-persisted attempts/answers, autosaved writing responses, objective scoring and results
- Student dashboard, profile, results, mobile-ready test interface and finish confirmation
- Admin overview, searchable users and test creation
- A normalized PostgreSQL production schema reference in `schema.sql`

## Submissions (topshirilgan testlar)

One completed test = exactly one record in `data.json` → `submissions` (unique per `attemptId`).

- `POST /api/attempts/:id/finish` is idempotent: repeated/parallel calls return the same submission (`alreadySubmitted: true`). Empty attempts cannot be submitted.
- Statuses: `pending_admin` → **Admin javobi kutilmoqda**, `in_review` → **Tekshirilmoqda**, `ready` → **Natija tayyor**. The status is always recomputed from the answers and evaluations, so it cannot drift.
- Categories: Multilevel, Speaking, Listening, Writing, Reading (taken from the test's category). A Multilevel test is one Multilevel submission, never one per module.
- Student: `GET /api/submissions` (used by the Results page). Admin/examiner: `GET /api/admin/submissions?category=&status=`, `GET|POST /api/admin/submissions/:id[/open]`.
- **Multilevel natija oqimi (Part 2):** Multilevel topshiriq har doim `Admin javobi kutilmoqda` bilan boshlanadi (yozma/og'zaki javob bo'lmasa ham). Admin ochganda `Tekshirilmoqda`. Admin barcha topshiriqlarni baholab **«Natijani saqlash»** (`POST /api/admin/submissions/:id/finalize`) ni bosgandan keyingina `Natija tayyor` bo'ladi. Shundan keyingina foydalanuvchi Overall Score, Level, Listening/Reading/Writing/Speaking va sanani ko'radi. Tayyor bo'lguncha ball, sertifikat va dashboard statistikasiga ham kirmaydi.
- - **Admin tekshirish sahifasi (Part 3):** Multilevel topshiriqda «TEKSHIRISH» `/admin/reviews/:submissionId` sahifasini ochadi (sahifa ochilganda holat `Tekshirilmoqda`). Chapda nomzod (Familyasi/Ismi hisobdan avtomatik, Chet tili: Ingliz tili, Berilgan sanasi avtomatik) va sertifikat namunasi, o'ngda Listening/Reading/Writing/Speaking/Overall Score formasi. «Natijani saqlash» `POST /api/admin/submissions/:id/result` orqali **mavjud topshiriqni yangilaydi** (ID o'zgarmaydi, yangi yozuv yaratilmaydi) va holatni `Natija tayyor` qiladi. Ballar 0–100 oralig'ida son bo'lishi shart (server ham tekshiradi). Admin kiritgan ballar avtomatik hisoblanganlardan ustun turadi.
- **Avtomatik CEFR daraja (Part 4):** Multilevel Overall Score (butun son) bo'yicha daraja server qoidasi bilan hisoblanadi: 40–49 = B1, 50–60 = B2, 61+ = C1, 40 dan past = `Level not assigned` (sertifikat berilmaydi). Admin darajani tanlamaydi, u Overall o'zgarishi bilan jonli yangilanadi. «SAVE RESULT» ballar, daraja, berilgan sana (`issuedAt`, birinchi saqlashda), tekshirilgan sana (`checkedAt`, har saqlashda) va statusni mavjud topshiriqqa yozadi. Talabaning Natijalar sahifasi kutish holatida bo'lsa, ~8 soniyada o'zi yangilanadi. Qoida `server.js` dagi `CEFR_RULES` da; boshqa kategoriyalar eski `settings.thresholds` dan foydalanadi.
- While a submission of a test is still unchecked, the same user cannot start a new attempt of that test. Set `BLOCK_RETAKE_WHILE_PENDING=false` in `server.js` to allow retakes.
- On start-up the server creates missing submissions for old completed attempts (attempts with no answers are skipped). This is idempotent.

## Production handoff

The dependency-free local persistence adapter makes the prototype immediately runnable. Before public deployment, implement the supplied PostgreSQL schema through a database repository; then add CSRF protection for cookie sessions, a durable session store, rate limiter, object storage with malware scanning for uploads, transactional payment-provider adapters, and an email/SMS verification service.
