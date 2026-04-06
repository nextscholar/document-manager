# Document Manager – Mobile App

A React Native (Expo) companion for the [Document Manager](../) backend.
The app lets users **upload documents** (file picker, photo library, camera),
**search** across the library with semantic + full-text search, and
**browse** their documents on the go.

---

## Features

| Feature | Description |
|---|---|
| 📱 Dark-themed UI | Consistent with the web frontend |
| 🔐 Stack Auth | Email/password sign-in; OAuth via system browser |
| 📂 File upload | Document picker, photo library, camera capture |
| 🔗 Share from other apps | Handles Android `SEND` intents and iOS share-sheet |
| 🔍 Semantic search | Queries the backend's hybrid search endpoint |
| 📋 Browse & delete | Paginated file list with sort options |
| 📄 Document detail | Metadata, tags, text preview, share |

---

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (`npm install -g expo-cli`)
- iOS Simulator / Android Emulator **or** [Expo Go](https://expo.dev/client) on a physical device
- A running instance of the [Document Manager backend](../backend/)
- A [Stack Auth](https://stack-auth.com/) project

---

## Setup

### 1. Install dependencies

```bash
cd mobile
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```env
# URL of your running backend (no trailing slash)
# For local dev on the same WiFi network, use your machine's LAN IP:
EXPO_PUBLIC_API_URL=http://192.168.1.100:8000

# From https://app.stack-auth.com → your project → API Keys
EXPO_PUBLIC_STACK_PROJECT_ID=your-project-id
EXPO_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=your-publishable-client-key
```

### 3. Start the development server

```bash
npm start
```

- Press **i** to open in iOS Simulator
- Press **a** to open in Android Emulator
- Scan the QR code with Expo Go on a physical device

---

## Stack Auth configuration

The mobile app authenticates users against the Stack Auth REST API directly
(no cookies or browser sessions). Tokens are stored in
[AsyncStorage](https://react-native-async-storage.github.io/async-storage/).

### Email/password

Email + password sign-in works out of the box with any Stack Auth project
that has the password credential provider enabled.

### OAuth (Google)

To enable "Sign in with Google":

1. In the Stack Auth dashboard, enable the **Google** OAuth provider.
2. **Add `https://smartsearch.nextscholar.site/auth/callback` as an allowed
   redirect URI** in both Stack Auth **and** the Google Cloud Console OAuth
   app.  Skipping this step causes a **"Redirect URL not in whitelist"** error
   on login.
3. Ensure the `scheme` in `app.json` matches (`"document-manager"`).

> **How the OAuth redirect works**  
> Stack Auth and Google only accept HTTPS redirect URIs. The app therefore
> sends `redirect_uri=https://smartsearch.nextscholar.site/auth/callback` to
> Stack Auth.  After authentication, Stack Auth redirects to that HTTPS URL.
> The web relay page at `/auth/callback` immediately redirects the browser to
> `document-manager://auth/callback?code=...`, which the mobile app intercepts
> to complete the sign-in.
>
> **Troubleshooting "Redirect URL not in whitelist"**: Go to  
> **Stack Auth → your project → Auth Methods → OAuth → Allowed Redirect URIs**  
> and add `https://smartsearch.nextscholar.site/auth/callback`.

---

## Project structure

```
mobile/
├── app/                    Expo Router screens
│   ├── _layout.tsx         Root layout + auth guard
│   ├── sign-in.tsx         Sign-in screen
│   ├── sign-up.tsx         Create-account screen
│   ├── auth/
│   │   └── callback.tsx    OAuth deep-link callback
│   ├── (tabs)/
│   │   ├── _layout.tsx     Bottom tab navigator
│   │   ├── index.tsx       Home / Search
│   │   ├── upload.tsx      File upload
│   │   └── browse.tsx      Browse documents
│   └── document/
│       └── [id].tsx        Document detail
├── src/
│   ├── auth.tsx            Stack Auth context + token store
│   ├── api.ts              Backend API client
│   └── types.ts            TypeScript domain types
├── assets/                 App icons and splash screen
├── app.json                Expo configuration
├── babel.config.js
├── package.json
└── tsconfig.json
```

---

## Backend requirements

The mobile app talks to the same REST API used by the web frontend:

| Endpoint | Usage |
|---|---|
| `POST /api/files/upload` | Upload files |
| `GET  /api/files` | List files (paginated) |
| `GET  /api/files/{id}` | File metadata |
| `GET  /api/files/{id}/text` | Extracted text |
| `DELETE /api/files/{id}` | Delete file record |
| `POST /api/search` | Semantic / hybrid search |

All requests include the `x-stack-access-token` header for authentication,
matching the pattern used by the web frontend.

---

## Building for production

```bash
# Build for iOS (requires macOS + Xcode)
npx eas build --platform ios

# Build for Android
npx eas build --platform android
```

See the [Expo EAS Build docs](https://docs.expo.dev/build/introduction/) for
full instructions.
