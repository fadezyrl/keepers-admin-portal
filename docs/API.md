# Keepers Adventures API

Base URL: `http://localhost:4000/api`

## Response shape

```json
{ "success": true, "data": {}, "message": "OK" }
```

```json
{ "success": false, "error": { "code": "CODE", "message": "..." } }
```

Auth header: `Authorization: Bearer <supabase_access_token>`

## Endpoints

### Auth
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/auth/signup` | No | Creates Auth user + pending profile |
| POST | `/auth/login` | No | Blocks pending/suspended/rejected |
| GET | `/auth/me` | Yes | Full profile + roles/permissions |
| POST | `/auth/forgot-password` | No | Supabase reset email (`redirectTo` / mobile deep link) |
| POST | `/auth/change-password` | Yes | `{ currentPassword, nextPassword }` |
| POST | `/auth/reset-password` | No | Recovery token → new password |
| POST | `/auth/delete-account` | Yes | `{ password }` reauth + scrub + auth delete |
| POST | `/auth/refresh` | No | `{ refreshToken }` |
| POST | `/auth/logout` | Yes | Best-effort revoke |

### Members
| Method | Path | Permission |
|--------|------|------------|
| GET | `/members/directory` | approved member |
| GET | `/members` | members.read / manage / dashboard |
| GET | `/members/:id` | approved member |
| PATCH | `/members/me` | approved member |
| POST | `/members/:id/status` | members.manage |
| POST | `/members/:id/roles` | roles.assign |
| DELETE | `/members/:id/roles/:role` | roles.assign |

### Trips
| Method | Path | Permission |
|--------|------|------------|
| GET | `/trips` | approved |
| GET | `/trips/calendar` | approved |
| GET | `/trips/mine/organized` | trips.create / manage_own / manage |
| GET | `/trips/:id` | approved |
| POST | `/trips` | trips.create / manage |
| PATCH | `/trips/:id` | trips.manage / manage_own |
| POST | `/trips/:id/status` | trips.manage / manage_own |
| DELETE | `/trips/:id` | trips.manage |
| POST | `/trips/:id/join` | approved |
| POST | `/trips/:id/cancel` | approved |
| POST | `/trips/:id/attendance` | attendance.mark |

### Ratings & upgrades
| Method | Path | Permission |
|--------|------|------------|
| GET/POST | `/ratings/criteria` | read all; write settings.manage |
| GET/POST | `/ratings` | ratings.create (write) |
| GET | `/ratings/upgrades/mine` | upgrades.recommend — own submissions |
| GET | `/ratings/upgrades` | upgrades.review / recommend |
| POST | `/ratings/upgrades/:id/review` | upgrades.review (not self) |

### Content & dashboard
| Method | Path | Notes |
|--------|------|-------|
| GET | `/content/home` | heroes, trips, sponsors, gallery |
| GET/POST/DELETE | `/content/sponsors` | manage permission on writes |
| GET/PATCH | `/content/documents/:slug` | |
| GET/POST | `/content/announcements` | |
| POST | `/content/announcements/:id/publish` | fans out in-app notifications |
| GET/POST | `/content/notifications` | |
| POST | `/content/media/upload` | multipart `file` + `bucket` |
| GET/PATCH | `/content/settings` | |
| GET | `/dashboard/stats` | dashboard.read |
| GET | `/dashboard/roles` | |
| GET | `/dashboard/membership-levels` | |
| GET | `/health` | public |
