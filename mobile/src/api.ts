/**
 * Auth-aware API client for the Document Manager backend.
 *
 * Mirrors the pattern used by the web frontend (frontend/src/lib/api.js):
 *   - every request includes `x-stack-access-token` from the current auth state
 *   - the base URL is read from EXPO_PUBLIC_API_URL
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  FilesListResponse,
  FileDetail,
  FileMetadata,
  UploadResponse,
  SearchResponse,
  AskResponse,
} from './types';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const ACCESS_TOKEN_KEY = '@dm:access_token';

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(ACCESS_TOKEN_KEY);
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { 'x-stack-access-token': token } : {};
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const auth = await authHeaders();
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...auth,
      ...((options.headers as Record<string, string> | undefined) ?? {}),
    },
  });
}

async function checkOk(res: Response): Promise<void> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) {
        // FastAPI validation errors return detail as an array of objects.
        if (Array.isArray(body.detail)) {
          detail = body.detail
            .map((e: { msg?: string }) => e.msg ?? String(e))
            .join(', ');
        } else {
          detail = String(body.detail);
        }
      }
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
}

// ---------------------------------------------------------------------------
// Files API
// ---------------------------------------------------------------------------

/** List files with pagination and optional sort. */
export async function listFiles(
  page = 1,
  limit = 30,
  sortBy = 'created_at-desc',
): Promise<FilesListResponse> {
  const skip = (page - 1) * limit;
  const res = await apiFetch(
    `/files?skip=${skip}&limit=${limit}&sort_by=${sortBy}`,
  );
  await checkOk(res);
  return res.json();
}

/** Fetch full metadata for a single file. */
export async function getFile(fileId: number): Promise<FileDetail> {
  const res = await apiFetch(`/files/${fileId}`);
  await checkOk(res);
  return res.json();
}

/** Delete a file record from the database. */
export async function deleteFile(fileId: number): Promise<void> {
  const res = await apiFetch(`/files/${fileId}`, { method: 'DELETE' });
  await checkOk(res);
}

/**
 * Upload one or more files to the backend inbox.
 *
 * @param files  Array of objects with `uri`, `name`, and `type` (MIME).
 *               Typically produced by expo-document-picker or expo-image-picker.
 */
export async function uploadFiles(
  files: Array<{ uri: string; name: string; type: string }>,
): Promise<UploadResponse> {
  const auth = await authHeaders();
  const form = new FormData();
  for (const f of files) {
    // React Native's FormData accepts `{ uri, name, type }` objects directly.
    form.append('files', { uri: f.uri, name: f.name, type: f.type } as unknown as Blob);
  }
  const res = await fetch(`${API_BASE}/files/upload`, {
    method: 'POST',
    headers: auth,
    body: form,
  });
  await checkOk(res);
  return res.json();
}

// ---------------------------------------------------------------------------
// Search API
// ---------------------------------------------------------------------------

/** Full-text + semantic search. */
export async function searchFiles(query: string, k = 20): Promise<SearchResponse> {
  const auth = await authHeaders();
  const res = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, k }),
  });
  await checkOk(res);
  return res.json();
}

// ---------------------------------------------------------------------------
// File text / content
// ---------------------------------------------------------------------------

/** Retrieve extracted text for a file (may be large). */
export async function getFileText(fileId: number): Promise<string> {
  const res = await apiFetch(`/files/${fileId}/text`);
  await checkOk(res);
  const data = await res.json();
  return (data?.text as string | undefined) ?? '';
}

// ---------------------------------------------------------------------------
// File metadata (enrichment + processing status)
// ---------------------------------------------------------------------------

/** Retrieve AI-enrichment metadata for a file. */
export async function getFileMetadata(fileId: number): Promise<FileMetadata> {
  const res = await apiFetch(`/files/${fileId}/metadata`);
  await checkOk(res);
  return res.json();
}

/** Return the URL for streaming a file's raw content (suitable for WebBrowser/download). */
export function getFileContentUrl(fileId: number): string {
  return `${API_BASE}/files/${fileId}/content`;
}


/**
 * Ask an LLM-powered question against the archive.
 *
 * @param query       Natural-language question or search phrase.
 * @param k           Number of source chunks to retrieve (default 10).
 * @param model       Optional model identifier (e.g. "ollama/llama3").
 * @param searchMode  One of "hybrid" | "vector" | "keyword" | "two_stage".
 */
export async function askAI(
  query: string,
  k = 10,
  model?: string,
  searchMode: 'hybrid' | 'vector' | 'keyword' | 'two_stage' = 'hybrid',
): Promise<AskResponse> {
  const res = await apiFetch('/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      k,
      model: model || undefined,
      search_mode: searchMode,
    }),
  });
  await checkOk(res);
  return res.json();
}
