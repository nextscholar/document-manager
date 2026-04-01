/**
 * Home / Search screen.
 *
 * Displays a search bar at the top and shows semantic search results
 * or a list of recent files when the query is empty.
 */
import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/auth';
import { searchFiles, listFiles } from '../../src/api';
import type { RawFile, SearchResult } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// File row – used in both recent list and search results
// ---------------------------------------------------------------------------

interface FileRowProps {
  id: number;
  title: string;
  subtitle: string;
  meta?: string;
  onPress: () => void;
}

function FileRow({ id, title, subtitle, meta, onPress }: FileRowProps) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <Ionicons name="document-text-outline" size={22} color="#4A9EFF" />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowSubtitle} numberOfLines={2}>{subtitle}</Text>
      </View>
      {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color="#444" />
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recent, setRecent] = useState<RawFile[]>([]);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadRecent = useCallback(async () => {
    try {
      const data = await listFiles(1, 20, 'created_at-desc');
      setRecent(data.files);
    } catch (err: unknown) {
      console.warn('Failed to load recent files:', (err as Error).message);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  // Trigger search when query changes (debounced by press)
  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const data = await searchFiles(query.trim());
      setResults(data.results);
    } catch (err: unknown) {
      Alert.alert('Search failed', (err as Error).message);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRecent();
    setRefreshing(false);
  }, [loadRecent]);

  const isSearchMode = query.trim().length > 0;

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderSearchResult({ item }: { item: SearchResult }) {
    return (
      <FileRow
        id={item.file_id}
        title={item.filename}
        subtitle={item.snippet}
        meta={item.category ?? undefined}
        onPress={() => router.push(`/document/${item.file_id}`)}
      />
    );
  }

  function renderRecentFile({ item }: { item: RawFile }) {
    return (
      <FileRow
        id={item.id}
        title={item.filename}
        subtitle={item.summary ?? (item.category ?? 'No summary available')}
        meta={formatDate(item.created_at)}
        onPress={() => router.push(`/document/${item.id}`)}
      />
    );
  }

  function ListHeader() {
    if (isSearchMode) {
      return (
        <Text style={styles.sectionTitle}>
          {searching ? 'Searching…' : `${results.length} result${results.length !== 1 ? 's' : ''}`}
        </Text>
      );
    }
    return <Text style={styles.sectionTitle}>Recent Documents</Text>;
  }

  function ListEmpty() {
    if (searching) return null;
    if (isSearchMode) {
      return (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={48} color="#333" />
          <Text style={styles.emptyText}>No results found</Text>
          <Text style={styles.emptyHint}>Try a different search term</Text>
        </View>
      );
    }
    return (
      <View style={styles.empty}>
        <Ionicons name="cloud-upload-outline" size={48} color="#333" />
        <Text style={styles.emptyText}>No documents yet</Text>
        <Text style={styles.emptyHint}>Upload files from the Upload tab</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Greeting */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.greeting}>Hello{user?.email ? `, ${user.email.split('@')[0]}` : ''}</Text>
          <Text style={styles.greetingHint}>Search your document library</Text>
        </View>
        <TouchableOpacity onPress={signOut} style={styles.signOutBtn}>
          <Ionicons name="log-out-outline" size={22} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color="#555" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search documents…"
          placeholderTextColor="#555"
          returnKeyType="search"
          onSubmitEditing={handleSearch}
          clearButtonMode="while-editing"
        />
        {searching && (
          <ActivityIndicator size="small" color="#4A9EFF" style={styles.searchSpinner} />
        )}
      </View>

      {/* List */}
      {isSearchMode ? (
        <FlatList<SearchResult>
          data={results}
          keyExtractor={(item) => String(item.entry_id)}
          renderItem={renderSearchResult}
          ListHeaderComponent={<ListHeader />}
          ListEmptyComponent={<ListEmpty />}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      ) : (
        <FlatList<RawFile>
          data={recent}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderRecentFile}
          ListHeaderComponent={<ListHeader />}
          ListEmptyComponent={<ListEmpty />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#4A9EFF"
            />
          }
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F0F' },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  greeting: { fontSize: 22, fontWeight: '700', color: '#E8E8E8' },
  greetingHint: { fontSize: 13, color: '#666', marginTop: 2 },
  signOutBtn: { padding: 8 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    marginHorizontal: 20,
    marginBottom: 20,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 44, color: '#E8E8E8', fontSize: 15 },
  searchSpinner: { marginLeft: 8 },

  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    paddingHorizontal: 20,
    paddingBottom: 8,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  list: { paddingBottom: 40 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#0F0F0F',
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
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#E8E8E8', marginBottom: 3 },
  rowSubtitle: { fontSize: 12, color: '#777', lineHeight: 18 },
  rowMeta: { fontSize: 11, color: '#555', marginRight: 6 },

  separator: { height: 1, backgroundColor: '#1A1A1A', marginLeft: 68 },

  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#555', marginTop: 16 },
  emptyHint: { fontSize: 13, color: '#444', marginTop: 6, textAlign: 'center' },
});
