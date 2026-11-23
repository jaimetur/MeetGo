# Communities, board and plans

MeetGo is a platform of **communities**: themed areas of a zone (province + age range). Each community has a
**board** (threads, meetups, events and notices) and its own **chat room**. Meetups and events have attendees and a
**plan chat** (a group conversation) that attendees join automatically.

This document is the contract between the API (`src/backend/app/`) and the web sites (`src/frontend/`).
Dates are ISO 8601 UTC with `Z`. Every endpoint needs the session token unless marked public.

## Communities

A community is a `conversations` row of kind `channel`:

| Field | Meaning |
|---|---|
| `kind` | `"interest"` (automatic, one per interest + zone) or `"custom"` (created by a person) |
| `province`, `age_range` | its zone; only people of that zone can join or see it |
| `access_mode` | `open` (anyone in the zone joins), `request` (an owner, admin or moderator approves), `invite` (only with the invitation link; not listed to people outside) |
| `board_mode` | `open` (members publish on the board) or `admins` (read-only board: only owner, admins and moderators publish) |
| roles | `owner` (creator), `admin`, `moderator`, `member`. Owner and admins name admins and moderators; moderators moderate the chat and the board |

**Changing zone.** A membership whose community is not in the person's current zone is marked `away`: it disappears
from every list, sends no notifications and cannot post. When the person returns to that zone (same province and age
range) the membership comes back as it was, with its role, without asking to be admitted again. Joining the
communities of the new zone is up to the person (Explore); choosing interests still joins their interest communities.

### Endpoints

| Method and path | Body / query | Answer |
|---|---|---|
| `GET /communities` | `q?`, `mine?=1` | communities of my zone that I can see (invite-only ones only if I am a member): `Community[]` |
| `GET /communities/{id}` | | `Community` (with `rules`, `invite_code` for staff) |
| `POST /communities` | `{title, description?, avatar_url?, access_mode, board_mode}` | `Community` (I am the owner; zone = mine) |
| `PATCH /communities/{id}` | owner/admin: `{title?, description?, avatar_url?, access_mode?, board_mode?, rules?}` | `Community` |
| `POST /communities/{id}/join` | | `{status: "joined" \| "requested"}`; `invite` mode without link → 403; an `away` membership is restored |
| `POST /communities/join/{code}` | | `{status: "joined", community_id}` (invitation link `…/app/join/{code}`) |
| `POST /communities/{id}/invite` | staff | `{code, url}` (new code; old links stop working) |
| `DELETE /communities/{id}/membership` | | leave (an owner hands ownership to the oldest admin, or the oldest member) |
| `GET /communities/{id}/requests` | staff | `[{user: UserSummary, created_at}]` |
| `POST /communities/{id}/requests/{user_id}/resolve` | staff: `{accept: bool}` | `{ok}` |
| `GET /communities/{id}/members` | `q?` | `[{...UserSummary, role, online}]` |
| `PUT /communities/{id}/members/{user_id}/role` | owner/admin: `{role: "admin" \| "moderator" \| "member"}` | `{ok}` (only the owner names admins) |
| `DELETE /communities/{id}/members/{user_id}` | staff | remove someone |

`Community`:
```json
{"id": 12, "kind": "interest", "title": "Senderismo", "slug": "senderismo", "description": "…", "avatar_url": null,
 "province": "Madrid", "age_range": "31_50", "access_mode": "open", "board_mode": "open", "member_count": 37,
 "online_count": 5, "joined": true, "role": "member", "request_pending": false, "upcoming_count": 3,
 "conversation_id": 12, "rules": "…", "invite_code": null, "created_at": "…"}
```
`conversation_id` is the chat room (the same id): the existing `/conversations/{id}/messages` API serves it.

## Board

Board posts (`board_posts`) belong to one community. Kinds: `thread` (discussion), `meetup` (date, place, places),
`event` (bigger: cover, end time, link for tickets), `notice` (question, recommendation, announcement).

| Field | Meaning |
|---|---|
| `comments_mode` | `all` (any member), `attendees` (only people going and the organiser), `off` |
| `join_mode` | meetups/events: `open` or `approval` (the author or staff accepts) |
| `capacity` | places; when full, new people go to the waiting list and move up when someone leaves |
| `chat_conversation_id` | the plan chat (a group): created with the first meetup/event, attendees join and leave it automatically; visible only to the organiser and people going |
| `pinned`, `closed` | staff pin; the author or staff close (no more comments or sign-ups) |

### Endpoints

| Method and path | Body / query | Answer |
|---|---|---|
| `GET /board/feed` | `kind?`, `when?=all\|today\|weekend\|week\|upcoming\|past`, `community_id?`, `before_id?`, `limit?=20` | `{posts: Post[], has_more}`: posts of my communities (not away), pinned first in a community view, newest first; for `today/weekend/week/upcoming` meetups and events ordered by `starts_at` |
| `GET /communities/{id}/posts` | same filters | same, for one community |
| `POST /communities/{id}/posts` | `{kind, title, body?, starts_at?, ends_at?, place?, place_url?, capacity?, link_url?, cover_attachment_id?, comments_mode?, join_mode?}` | `Post` (members; staff only when `board_mode = admins`; meetup/event need `starts_at`) |
| `GET /posts/{id}` | | `Post` with `attendees` (first 12), `my_status`, `chat_conversation_id` (if going or organiser) |
| `PATCH /posts/{id}` | author or staff (staff only for `pinned`) | `Post`; changing date or place notifies attendees |
| `DELETE /posts/{id}` | author or staff | `{ok}` (attendees are told; the plan chat stays, read-only) |
| `POST /posts/{id}/attend` | | `{status: "going" \| "waitlist" \| "pending"}` |
| `DELETE /posts/{id}/attend` | | `{ok}` (first on the waiting list moves up) |
| `GET /posts/{id}/attendees` | | `[{...UserSummary, status}]` (pending ones only to author/staff) |
| `POST /posts/{id}/attendees/{user_id}/resolve` | author/staff: `{accept}` | `{ok}` |
| `GET /posts/{id}/comments` | `before_id?` | `{comments: Comment[], has_more}` (oldest first) |
| `POST /posts/{id}/comments` | `{body}` | `Comment` (respecting `comments_mode`, `closed`) |
| `DELETE /comments/{id}` | author or staff | `{ok}` |
| `POST /posts/{id}/report` | `{reason, details?}` | `{ok}` (goes to the administration's moderation queue) |
| `GET /me/plans` | `when=upcoming\|past\|organizing` | `Post[]` meetups/events I go to or organise |

`Post`:
```json
{"id": 5, "community": {"id": 12, "title": "Senderismo", "slug": "senderismo"}, "kind": "meetup",
 "author": {"id": 3, "display_name": "Marta Gil", "avatar_url": null}, "title": "Ruta Cercedilla", "body": "…",
 "starts_at": "2026-11-29T08:00:00Z", "ends_at": null, "place": "Estación de Cercedilla", "place_url": null,
 "capacity": 8, "going_count": 5, "waitlist_count": 0, "link_url": null, "cover_url": null,
 "comments_mode": "attendees", "join_mode": "open", "comment_count": 2, "pinned": false, "closed": false,
 "my_status": "going", "can_comment": true, "can_edit": false, "chat_conversation_id": 44,
 "attendees": [{"id": 3, "display_name": "Marta Gil", "avatar_url": null}], "created_at": "…", "updated_at": "…"}
```
`Comment`: `{id, post_id, author: UserSummary, body, created_at, can_delete}`.

Notes on the implementation (additions, nothing above changes):
- `GET /board/feed` and `GET /communities/{id}/posts` also take `tz?` (IANA name, default `Europe/Madrid`) for
  `today`/`weekend`/`week`. `before_id` is the last post already shown: the next page continues after it (also for
  the lists ordered by `starts_at`). A meetup or event is "past" once `ends_at` (or `starts_at`) has gone by.
- The organiser is always an attendee (`going`) of their meetup/event and cannot leave it (`409`); a full plan sends
  new people to the waiting list, and raising `capacity` with `PATCH` moves the waiting list up.
- Signing up needs membership of the community (`403` otherwise) and a plan that is not closed nor past (`409`).
- `PATCH /posts/{id}`: `capacity: 0` removes the limit, `cover_attachment_id: 0` removes the cover. A deleted post's
  plan chat stays read-only (`403` on new messages).
- `GET /channels/explore` keeps working: away memberships do not count, invitation-only communities show only to
  their members, and each item also has `access_mode`. `POST /channels/{interest_id}/join` answers `403` for a
  community that needs approval or an invitation.
- `GET /admin/reports`: each item has `kind` (`message` or `post`) and, for posts, `post`; `message` then carries the
  post in the shape of a message. Resolving with `delete_message: true` deletes the post.
- Real-time payloads: `post.created`/`post.updated`/`post.deleted` and `attendance.changed` are
  `{type, community_id, post_id}`; `comment.created` adds `comment`; `comment.deleted` (extra) has `comment_id`.
  Join requests: `community.request` `{community_id, user_id}` to staff; `community.joined` `{community_id}` to the
  accepted person.
- Push notifications that are not chat messages carry `{type: "plan" | "community.request" | "community.joined",
  title, body, url}`; links: posts `/app/p/{id}`, communities `/app/communities/{id}`.

### Notifications

Real-time events (WebSocket, to community members or attendees): `post.created`, `post.updated`, `post.deleted`,
`comment.created`, `attendance.changed`. Push and email (with each person's choices): someone joins your plan or asks
to; you are accepted or move up from the waiting list; a plan you go to changes or is cancelled; a reminder the day
before (email preference `plans`, on by default); a request to join a community you administer (preference
`requests`); your request is accepted.

## Screens (web and phones)

Bottom bar on phones / side menu on the web: **Home** (board of my communities, filters Today / Weekend / Week / Meetups /
Events / Notices), **Plans** (Going / Organising / Past, each with its chat), **＋ Publish**, **Chats**, **Profile**.
Communities: list of my zone's communities with search and "Create community"; community page with tabs
**Board · Chat · Members** (roles, requests, invitation link and settings for staff). Post page: details, people going,
"Sign up"/"Leave", "Open the plan chat", comments, and "Repeat" (a new post with the same details) for past plans.
