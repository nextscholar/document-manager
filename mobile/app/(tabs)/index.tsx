/**
 * Home / Search screen.
 *
 * Displays a search bar at the top and shows semantic search results
 * or a list of recent files when the query is empty.
 *
 * Two modes are available via a toggle:
 *  - "Search" – fast semantic/hybrid search returning ranked snippets.
 *  - "Ask AI"  – LLM-powered question answering with cited sources.
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
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/auth';
import { searchFiles, listFiles, askAI } from '../../src/api';
import type { RawFile, SearchResult, AskResponse } from '../../src/types';

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
// AI Answer card
// ---------------------------------------------------------------------------

interface AiAnswerCardProps {
  result: AskResponse;
  onSourcePress: (fileId: number) => void;
}

function AiAnswerCard({ result, onSourcePress }: AiAnswerCardProps) {
  const [expanded, setExpanded] = useState(false);
  const answerText = result.answer ?? '';
  const preview = answerText.slice(0, 400);
  const needsExpand = answerText.length > 400;

  return (
    <View style={styles.aiCard}>
      <View style={styles.aiCardHeader}>
        <Ionicons name="sparkles" size={16} color="#A78BFA" />
        <Text style={styles.aiCardTitle}>AI Answer</Text>
        {result.timing?.total_ms != null && (
          <Text style={styles.aiCardTiming}>{Math.round(result.timing.total_ms)}ms</Text>
        )}
      </View>

      <Text style={styles.aiAnswer} selectable>
        {expanded || !needsExpand ? answerText : preview + '…'}
      </Text>
      {needsExpand && (
        <TouchableOpacity onPress={() => setExpanded((v) => !v)} style={styles.expandBtn}>
          <Text style={styles.expandBtnText}>{expanded ? 'Show less' : 'Show more'}</Text>
        </TouchableOpacity>
      )}

      {result.sources && result.sources.length > 0 && (
        <View style={styles.sourcesSection}>
          <Text style={styles.sourcesLabel}>
            Sources ({result.sources.length}{result.total_found && result.total_found > result.sources.length ? ` of ${result.total_found}` : ''})
          </Text>
          {result.sources.map((src, i) => (
            <TouchableOpacity
              key={src.id != null ? String(src.id) : `src-${i}`}
              style={styles.sourceRow}
              onPress={() => src.file_id != null && onSourcePress(src.file_id)}
              disabled={src.file_id == null}
              activeOpacity={0.7}
            >
              <Ionicons name="document-outline" size={14} color="#4A9EFF" style={{ marginRight: 6 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceTitle} numberOfLines={1}>
                  {src.title ?? src.path?.split('/').pop() ?? 'Untitled'}
                </Text>
                {src.path ? (
                  <Text style={styles.sourcePath} numberOfLines={1}>{src.path}</Text>
                ) : null}
              </View>
              {src.file_id != null && (
                <Ionicons name="chevron-forward" size={14} color="#444" />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

type SearchMode = 'search' | 'ask';

export default function HomeScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('search');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [aiResult, setAiResult] = useState<AskResponse | null>(null);
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

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([]);
      setAiResult(null);
      return;
    }
    setSearching(true);
    setResults([]);
    setAiResult(null);
    try {
      if (mode === 'ask') {
        const data = await askAI(query.trim());
        setAiResult(data);
      } else {
        const data = await searchFiles(query.trim());
        setResults(data.results);
      }
    } catch (err: unknown) {
      Alert.alert('Search failed', (err as Error).message);
    } finally {
      setSearching(false);
    }
  }, [query, mode]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRecent();
    setRefreshing(false);
  }, [loadRecent]);

  // Clear results when switching modes
  const handleModeChange = useCallback((newMode: SearchMode) => {
    setMode(newMode);
    setResults([]);
    setAiResult(null);
  }, []);

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
    if (mode === 'ask') return null; // AI mode shows answer card, not a count header
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
    if (isSearchMode && mode === 'search') {
      return (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={48} color="#333" />
          <Text style={styles.emptyText}>No results found</Text>
          <Text style={styles.emptyHint}>Try a different search term</Text>
        </View>
      );
    }
    if (!isSearchMode) {
      return (
        <View style={styles.empty}>
          <Ionicons name="cloud-upload-outline" size={48} color="#333" />
          <Text style={styles.emptyText}>No documents yet</Text>
          <Text style={styles.emptyHint}>Upload files from the Upload tab</Text>
        </View>
      );
    }
    return null;
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

      {/* Mode Toggle */}
      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'search' && styles.modeBtnActive]}
          onPress={() => handleModeChange('search')}
          activeOpacity={0.8}
        >
          <Ionicons name="search-outline" size={14} color={mode === 'search' ? '#E8E8E8' : '#666'} style={{ marginRight: 5 }} />
          <Text style={[styles.modeBtnText, mode === 'search' && styles.modeBtnTextActive]}>Search</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'ask' && styles.modeBtnActive, mode === 'ask' && styles.modeBtnAsk]}
          onPress={() => handleModeChange('ask')}
          activeOpacity={0.8}
        >
          <Ionicons name="sparkles-outline" size={14} color={mode === 'ask' ? '#E8E8E8' : '#666'} style={{ marginRight: 5 }} />
          <Text style={[styles.modeBtnText, mode === 'ask' && styles.modeBtnTextActive]}>Ask AI</Text>
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={[styles.searchBar, mode === 'ask' && styles.searchBarAsk]}>
        <Ionicons
          name={mode === 'ask' ? 'sparkles-outline' : 'search-outline'}
          size={18}
          color={mode === 'ask' ? '#A78BFA' : '#555'}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={mode === 'ask' ? 'Ask your archive a question…' : 'Search documents…'}
          placeholderTextColor="#555"
          returnKeyType="search"
          onSubmitEditing={handleSearch}
          clearButtonMode="while-editing"
          multiline={mode === 'ask'}
          numberOfLines={mode === 'ask' ? 3 : 1}
        />
        {searching ? (
          <ActivityIndicator size="small" color={mode === 'ask' ? '#A78BFA' : '#4A9EFF'} style={styles.searchSpinner} />
        ) : (
          <TouchableOpacity onPress={handleSearch} style={styles.searchSubmit} disabled={!query.trim()}>
            <Ionicons name="arrow-forward-circle" size={26} color={query.trim() ? (mode === 'ask' ? '#A78BFA' : '#4A9EFF') : '#333'} />
          </TouchableOpacity>
        )}
      </View>

      {/* Mode hint */}
      {mode === 'ask' && !isSearchMode && (
        <Text style={styles.modeHint}>
          Ask a natural-language question — the AI will find relevant documents and compose an answer.
        </Text>
      )}

      {/* AI Answer (Ask mode) */}
      {mode === 'ask' && isSearchMode && (
        <ScrollView style={styles.aiScrollArea} contentContainerStyle={{ paddingBottom: 40 }}>
          {searching ? (
            <View style={styles.aiThinking}>
              <ActivityIndicator color="#A78BFA" />
              <Text style={styles.aiThinkingText}>Thinking…</Text>
            </View>
          ) : aiResult ? (
            <AiAnswerCard
              result={aiResult}
              onSourcePress={(fileId) => router.push(`/document/${fileId}`)}
            />
          ) : null}
        </ScrollView>
      )}

      {/* Search results / Recent list (Search mode) */}
      {mode === 'search' && (
        isSearchMode ? (
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
        )
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

  modeToggle: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  modeBtnActive: {
    backgroundColor: '#2A2A2A',
  },
  modeBtnAsk: {
    backgroundColor: '#2D1F4E',
  },
  modeBtnText: { fontSize: 13, fontWeight: '600', color: '#666' },
  modeBtnTextActive: { color: '#E8E8E8' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  searchBarAsk: {
    alignItems: 'flex-start',
  },
  searchIcon: { marginRight: 8, marginTop: 13 },
  searchInput: { flex: 1, minHeight: 44, color: '#E8E8E8', fontSize: 15, paddingTop: 10, paddingBottom: 10 },
  searchSpinner: { marginLeft: 8, marginTop: 10 },
  searchSubmit: { padding: 6, marginTop: 4 },

  modeHint: {
    fontSize: 12,
    color: '#555',
    marginHorizontal: 20,
    marginBottom: 12,
    lineHeight: 18,
  },

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

  // AI mode styles
  aiScrollArea: { flex: 1 },
  aiThinking: { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 10 },
  aiThinkingText: { color: '#A78BFA', fontSize: 14 },

  aiCard: {
    margin: 16,
    backgroundColor: '#12101E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2D1F4E',
    padding: 16,
  },
  aiCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 6 },
  aiCardTitle: { fontSize: 14, fontWeight: '700', color: '#A78BFA', flex: 1 },
  aiCardTiming: { fontSize: 11, color: '#555' },
  aiAnswer: { fontSize: 14, color: '#CCC', lineHeight: 22 },
  expandBtn: { marginTop: 8, alignSelf: 'flex-start' },
  expandBtnText: { fontSize: 13, color: '#A78BFA', fontWeight: '600' },

  sourcesSection: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#2D1F4E' },
  sourcesLabel: { fontSize: 12, fontWeight: '600', color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  sourceTitle: { fontSize: 13, color: '#CCC', fontWeight: '500' },
  sourcePath: { fontSize: 11, color: '#555', marginTop: 2 },
});
