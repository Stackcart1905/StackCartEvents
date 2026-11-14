# StackCart Events

An events platform for StackCart with a React client and an Express/MongoDB API.
Participants can create accounts, browse events, and apply while applications
are open. The environment-configured admin can manage events and view applicant
contact details.

## Plan and boundaries

1. Establish separate participant and admin authentication, with the admin
   provisioned only from server environment credentials.
2. Deliver a public event catalogue and authenticated, deadline-aware,
   one-application-per-participant workflow.
3. Give admins event creation, editing, deletion, thumbnail upload, and
   participant roster views.
4. Validate inputs and uploads, document local setup, and build the client.

## Requirements

- Node.js 20.19+ and npm
- MongoDB (local or hosted)
- Render (optional, for hosted deployment)

## Setup

1. Install dependencies from the project root:

   ```sh
   npm install
   ```

2. Copy `server/.env.example` to `server/.env` and set `MONGODB_URI`,
   `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
3. Start MongoDB, then run `npm run dev` from the project root. The client
   starts at http://localhost:5173 and the API at http://localhost:5000.

## Deploy to Render

Deploy this repository as a **Web Service** with its root directory set to the
repository root (leave Render's Root Directory blank). Use:

- Build command: `npm ci --include=dev && npm run build --workspace client`
- Start command: `npm start`
- Health check path: `/api/health`

Set `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in the
Render service's environment settings. The server serves the built React app
and API from the same origin; it uses Render's `RENDER_EXTERNAL_HOSTNAME` for
same-origin CORS/CSRF checks when `CLIENT_ORIGIN` is not explicitly set. Do not
add `.env` files to Git or enter real credentials in a checked-in template.

The configured admin account is created or refreshed when the server starts.
Use its configured email and password to sign in; public registration always
creates participant accounts. Do not expose server environment variables to
the browser.

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`,
  `GET /api/auth/me`
- `GET /api/events` and `GET /api/events/:id`
- Admin-only `POST /api/events`, `PATCH /api/events/:id`,
  `DELETE /api/events/:id`, `GET /api/events/:id/participants`
- Participant-only `POST /api/events/:id/apply` (accepts answers and optional
  image/video files as multipart form data)
- Admin-only `GET /api/events/submission-files/:filename`

Authentication uses an HTTP-only cookie. Event thumbnails are stored in the
public `server/uploads` folder. Applicant image/video uploads are stored
separately in `server/privateUploads` and are only served to authenticated
admins viewing that event's responses. Use durable object storage and a
persistent volume for production deployments. Configure `CLIENT_ORIGIN` to the
exact browser origin in production; non-read API requests from other browser
origins are rejected.

Admins can add up to 30 application questions per event: short/long text, email,
number, single-choice, multiple-choice, image upload (10 MB max), or video
upload (50 MB max). Each question can be required or optional; choice questions
support up to 20 options. Responses are saved with the participant application
and displayed in the admin participant list.
