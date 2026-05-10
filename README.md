# BeeFriends Match Chat Service

Matching, conversation, realtime chat, read receipt, typing, and presence service for BeeFriends.

---

## Features

- **Discover** - returns candidate profiles for the Explore screen
- **Swipe** - records like/pass actions and creates matches when both users like each other
- **Matches** - lists active matches and supports unmatch
- **Conversations** - creates and retrieves user conversations
- **Messages** - sends messages, loads conversation history, and marks messages as read
- **Realtime Chat** - Socket.IO events for messages, read receipts, typing, and presence
- **Profile Sync** - consumes user, campus, major, and hobby events from User Service
- **Pub/Sub** - PostgreSQL `LISTEN/NOTIFY` with durable event table support

---

## Tech Stack

| Layer | Stack |
| ----- | ----- |
| Runtime | Node.js, NestJS, TypeScript |
| Database | PostgreSQL, Prisma |
| Realtime | Socket.IO |
| Pub/Sub | PostgreSQL `LISTEN/NOTIFY`, durable `pubsub_events` table |
| Contracts | `@beefriends/shared-kernel` |

---

## API

| Environment | Base URL |
| ----------- | -------- |
| Production Gateway | `https://beefriends-be.drian.my.id/v1/matchchat` |
| Local | `http://localhost:3003/v1/matchchat` |

Swagger docs:

```txt
http://localhost:3003/v1/matchchat/docs
```

Main routes:

| Area | Routes |
| ---- | ------ |
| Messages | `/messages`, `/messages/conversation/:conversationId`, `/messages/:messageId/read` |
| Conversations | `/conversations`, `/conversations/user/:userId`, `/conversations/:id`, `/conversations/:id/messages` |
| Matches | `/matches/discover`, `/matches/swipe`, `/matches/user/:userId`, `/matches/:id` |
| Filters | `/matches/campuses`, `/matches/majors`, `/matches/hobbies` |
| Presence | `/presence/:userId`, `/presence/batch` |

Socket.IO connects through:

```txt
https://beefriends-be.drian.my.id/socket.io/
```

---

## Realtime Events

| Event | Purpose |
| ----- | ------- |
| `join_conversation` | Join a conversation room |
| `leave_conversation` | Leave a conversation room |
| `send_message` | Send a realtime message |
| `message_received` | Broadcast a new message |
| `message_read` | Broadcast read receipts |
| `typing_start` | Broadcast typing started |
| `typing_stop` | Broadcast typing stopped |
| `presence_get` | Request presence for multiple users |
| `presence_changed` | Broadcast online/offline changes |

Event names are exported from `@beefriends/shared-kernel/dto`.

---

## Architecture

```txt
BeeFriends Mobile
  -> API Gateway
    -> Match Chat Service
      -> PostgreSQL
      -> Socket.IO rooms
      -> PostgreSQL pub/sub channels
```

Match and chat events are published to pub/sub so notification and realtime listeners can react without tight coupling.

---

## Environment Variables

```env
PORT=3003
API_PREFIX=v1/matchchat
API_DOCS_PATH=v1/matchchat/docs
CORS_ORIGINS=*

MATCH_CHAT_DATABASE_URL=
DATABASE_URL=
PUBSUB_DATABASE_URL=
PUBSUB_CONSUMER_ID=
PUBSUB_POLL_INTERVAL_MS=5000
PUBSUB_RECONNECT_INTERVAL_MS=5000
```

`MATCH_CHAT_DATABASE_URL` is preferred. `DATABASE_URL` is accepted as a fallback by Prisma.

---

## Getting Started

```bash
npm install
npm run prisma:generate
npm run prisma:push
npm run start:dev
```

---

## Scripts

| Command | Description |
| ------- | ----------- |
| `npm run start:dev` | Start service in watch mode |
| `npm run build` | Compile NestJS app |
| `npm run start:prod` | Run compiled app |
| `npm run lint` | Run ESLint with fixes |
| `npm run test` | Run unit tests |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run local Prisma migration |
| `npm run prisma:push` | Push schema to database |
| `npm run prisma:studio` | Open Prisma Studio |
