/**
 * Browse screen – paginated list of all documents belonging to the current user.
 */
import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { listFiles, deleteFile } from '../../src/api';
import type { RawFile } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 30;

const EXT_ICON: Record<string, keyof typeof import('@expo/vector-icons').Ionicons.glyphMap> = {
  pdf: 'document-outline',
  doc: 'document-text-outline',
  docx: 'document-text-outline',
  txt: 'document-text-outline',
  md: 'document-text-outline',
  jpg: 'image-outline',
  jpeg: 'image-outline',
  png: 'image-outline',
  gif: 'image-outline',
  webp: 'image-outline',
};

function fileIcon(ext: string | null): keyof typeof import('@expo/vector-icons').Ionicons.glyphMap {
  return EXT_ICON[ext?.toLowerCase() ?? ''] ?? 'document-outline';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

interface FileRowProps {
  file: RawFile;
  onPress: () => void;
  onDelete: () => void;
}

function FileRow({ file, onPress, onDelete }: FileRowProps) {
  function confirmDelete() {
    Alert.alert(
      'Delete document',
      `Remove "${file.filename}" from the database? The original file on disk will NOT be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ],
    );
  }

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <Ionicons name={fileIcon(file.extension)} size={20} color="#4A9EFF" />
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{file.filename}</Text>
        <View style={styles.rowMeta}>
          {file.category ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{file.category}</Text>
            </View>
          ) : null}
          <Text style={styles.rowDate}>{formatDate(file.created_at)}</Text>
          {file.file_size != null ? (
            <Text style={styles.rowSize}>{formatBytes(file.file_size)}</Text>
          ) : null}
        </View>
      </View>

      <TouchableOpacity onPress={confirmDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="trash-outline" size={18} color="#444" />
      </TouchableOpacity>

      <Ionicons name="chevron-forward" size={16} color="#333" style={{ marginLeft: 8 }} />
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

type SortOption = 'created_at-desc' | 'created_at-asc' | 'filename-asc' | 'filename-desc';

const SORT_LABELS: Record<SortOption, string> = {
  'created_at-desc': 'Newest first',
  'created_at-asc': 'Oldest first',
  'filename-asc': 'Name A→Z',
  'filename-desc': 'Name Z→A',
};

export default function BrowseScreen() {
  const router = useRouter();
  const [files, setFiles] = useState<RawFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('created_at-desc');
  const [showSort, setShowSort] = useState(false);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadPage = useCallback(
    async (p: number, sort: SortOption, replace: boolean) => {
      try {
        const data = await listFiles(p, PAGE_SIZE, sort);
        setTotal(data.total);
        setFiles((prev) => (replace ? data.files : [...prev, ...data.files]));
        setPage(p);
      } catch (err: unknown) {
        Alert.alert('Load failed', (err as Error).message);
      }
    },
    [],
  );

  useEffect(() => {
    setLoading(true);
    loadPage(1, sortBy, true).finally(() => setLoading(false));
  }, [sortBy]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPage(1, sortBy, true);
    setRefreshing(false);
  }, [sortBy]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || files.length >= total) return;
    setLoadingMore(true);
    await loadPage(page + 1, sortBy, false);
    setLoadingMore(false);
  }, [loadingMore, files.length, total, page, sortBy]);

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  const handleDelete = useCallback(
    async (fileId: number) => {
      try {
        await deleteFile(fileId);
        setFiles((prev) => prev.filter((f) => f.id !== fileId));
        setTotal((t) => Math.max(0, t - 1));
      } catch (err: unknown) {
        Alert.alert('Delete failed', (err as Error).message);
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4A9EFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header row */}
      <View style={styles.header}>
        <Text style={styles.headerCount}>
          {total} document{total !== 1 ? 's' : ''}
        </Text>
        <TouchableOpacity
          style={styles.sortBtn}
          onPress={() => setShowSort((v) => !v)}
        >
          <Ionicons name="funnel-outline" size={16} color="#AAA" style={{ marginRight: 4 }} />
          <Text style={styles.sortBtnText}>{SORT_LABELS[sortBy]}</Text>
        </TouchableOpacity>
      </View>

      {/* Sort dropdown */}
      {showSort && (
        <View style={styles.sortMenu}>
          {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
            <TouchableOpacity
              key={opt}
              style={[styles.sortMenuItem, opt === sortBy && styles.sortMenuItemActive]}
              onPress={() => {
                setSortBy(opt);
                setShowSort(false);
              }}
            >
              <Text
                style={[styles.sortMenuItemText, opt === sortBy && styles.sortMenuItemTextActive]}
              >
                {SORT_LABELS[opt]}
              </Text>
              {opt === sortBy && (
                <Ionicons name="checkmark" size={16} color="#4A9EFF" />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        data={files}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <FileRow
            file={item}
            onPress={() => router.push(`/document/${item.id}`)}
            onDelete={() => handleDelete(item.id)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={56} color="#222" />
            <Text style={styles.emptyText}>No documents found</Text>
            <Text style={styles.emptyHint}>Upload files from the Upload tab</Text>
          </View>
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color="#4A9EFF" style={{ paddingVertical: 20 }} />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#4A9EFF"
          />
        }
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F0F' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F0F0F' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  headerCount: { fontSize: 14, color: '#666' },
  sortBtn: { flexDirection: 'row', alignItems: 'center' },
  sortBtnText: { fontSize: 13, color: '#AAA' },

  sortMenu: {
    backgroundColor: '#1A1A1A',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  sortMenuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  sortMenuItemActive: { backgroundColor: '#0F0F0F' },
  sortMenuItemText: { fontSize: 14, color: '#888' },
  sortMenuItemTextActive: { color: '#4A9EFF', fontWeight: '600' },

  list: { paddingBottom: 40 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowBody: { flex: 1, marginRight: 8 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#E8E8E8', marginBottom: 4 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowDate: { fontSize: 11, color: '#555' },
  rowSize: { fontSize: 11, color: '#555' },

  badge: {
    backgroundColor: '#1E2B3A',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, color: '#4A9EFF', fontWeight: '600', textTransform: 'capitalize' },

  separator: { height: 1, backgroundColor: '#1A1A1A', marginLeft: 68 },

  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#555', marginTop: 16 },
  emptyHint: { fontSize: 13, color: '#444', marginTop: 6, textAlign: 'center' },
});
