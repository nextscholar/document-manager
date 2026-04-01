// Core domain types mirroring the backend API responses.

export interface RawFile {
  id: number;
  filename: string;
  content_hash: string | null;
  category: string | null;
  summary: string | null;
  tags: string[] | null;
  created_at: string | null;
  mtime: string | null;
  file_size: number | null;
  extension: string | null;
  uploaded_by: string | null;
  status: string | null;
}

export interface FileDetail extends RawFile {
  path: string | null;
  page_count: number | null;
  word_count: number | null;
  language: string | null;
  is_image: boolean;
}

export interface FilesListResponse {
  files: RawFile[];
  total: number;
  page: number;
  limit: number;
}

export interface UploadResponse {
  uploaded: string[];
  count: number;
}

export interface SearchResult {
  entry_id: number;
  file_id: number;
  filename: string;
  snippet: string;
  score: number;
  tags: string[] | null;
  category: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  total: number;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}
