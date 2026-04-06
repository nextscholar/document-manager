/**
 * Document detail screen.
 *
 * Shows metadata (category, tags, summary, dates, file size) and,
 * if the backend can extract text, a scrollable text preview.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Share,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getFile, getFileText, getFileMetadata } from '../../src/api';
import type { FileDetail, FileMetadata } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface MetaRowProps {
  icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap;
  label: string;
  value: string;
}

function MetaRow({ icon, label, value }: MetaRowProps) {
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={16} color="#555" style={styles.metaIcon} />
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const fileId = Number(id);

  const [file, setFile] = useState<FileDetail | null>(null);
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  // -------------------------------------------------------------------------
  // Load file metadata
  // -------------------------------------------------------------------------

  useEffect(() => {
    (async () => {
      try {
        const data = await getFile(fileId);
        setFile(data);
        navigation.setOptions({ title: data.filename });
      } catch (err: unknown) {
        setError((err as Error).message ?? 'Failed to load document');
      } finally {
        setLoading(false);
      }
    })();
  }, [fileId]);

  // -------------------------------------------------------------------------
  // Load AI metadata (enrichment, processing status, series)
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!fileId) return;
    getFileMetadata(fileId)
      .then(setMetadata)
      .catch((err: unknown) => {
        console.warn('Failed to load file metadata:', (err as Error).message);
      });
  }, [fileId]);

  // -------------------------------------------------------------------------
  // Load text preview
  // -------------------------------------------------------------------------

  const loadText = useCallback(async () => {
    if (text !== null || textLoading) return;
    setTextLoading(true);
    try {
      const t = await getFileText(fileId);
      setText(t);
    } catch {
      setText('');
    } finally {
      setTextLoading(false);
    }
  }, [fileId, text, textLoading]);

  useEffect(() => {
    if (file && !file.is_image) {
      loadText();
    }
  }, [file]);

  // -------------------------------------------------------------------------
  // Share
  // -------------------------------------------------------------------------

  const handleShare = useCallback(async () => {
    if (!file) return;
    setSharing(true);
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare && file.path) {
        // Try to share the file directly if it's on device
        // (In a real deployment the backend would return a download URL)
        await Sharing.shareAsync(file.path);
      } else {
        // Fall back to sharing the document name / metadata as text
        await Share.share({ message: `${file.filename}\n${file.summary ?? ''}`.trim() });
      }
    } catch (err: unknown) {
      Alert.alert('Share failed', (err as Error).message);
    } finally {
      setSharing(false);
    }
  }, [file]);

  // -------------------------------------------------------------------------
  // Render states
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4A9EFF" />
      </View>
    );
  }

  if (error || !file) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color="#555" />
        <Text style={styles.errorText}>{error ?? 'Document not found'}</Text>
      </View>
    );
  }

  const tags = file.tags?.filter(Boolean) ?? [];
  const textPreview =
    text != null && text.length > 0
      ? textExpanded
        ? text
        : text.slice(0, 1200)
      : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Title */}
      <View style={styles.titleRow}>
        <View style={styles.titleIcon}>
          <Ionicons
            name={file.is_image ? 'image-outline' : 'document-text-outline'}
            size={28}
            color="#4A9EFF"
          />
        </View>
        <Text style={styles.title} selectable>{file.filename}</Text>
      </View>

      {/* Summary */}
      {file.summary ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryText}>{file.summary}</Text>
        </View>
      ) : null}

      {/* Tags */}
      {tags.length > 0 && (
        <View style={styles.tagsRow}>
          {tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Metadata */}
      <View style={styles.metaCard}>
        {/* AI-enriched author (from metadata endpoint) */}
        {metadata?.enrichment?.author ? (
          <MetaRow icon="person-outline" label="Author" value={metadata.enrichment.author} />
        ) : null}
        {file.category && (
          <MetaRow icon="pricetag-outline" label="Category" value={file.category} />
        )}
        <MetaRow icon="calendar-outline" label="Created" value={formatDate(file.created_at)} />
        <MetaRow icon="time-outline" label="Modified" value={formatDate(file.mtime)} />
        <MetaRow icon="archive-outline" label="Size" value={formatBytes(file.file_size)} />
        {file.extension && (
          <MetaRow icon="code-slash-outline" label="Type" value={file.extension.toUpperCase()} />
        )}
        {file.language && (
          <MetaRow icon="globe-outline" label="Language" value={file.language} />
        )}
        {file.page_count != null && (
          <MetaRow icon="book-outline" label="Pages" value={String(file.page_count)} />
        )}
        {file.word_count != null && (
          <MetaRow
            icon="text-outline"
            label="Words"
            value={file.word_count.toLocaleString()}
          />
        )}
        {/* Processing status */}
        {metadata?.processing?.status ? (
          <MetaRow
            icon={metadata.processing.status === 'ok' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            label="Status"
            value={metadata.processing.status}
          />
        ) : null}
        {metadata?.processing?.entry_count != null ? (
          <MetaRow icon="layers-outline" label="Chunks" value={String(metadata.processing.entry_count)} />
        ) : null}
        {metadata?.processing?.doc_status ? (
          <MetaRow icon="analytics-outline" label="Embeddings" value={metadata.processing.doc_status} />
        ) : null}
      </View>

      {/* Series info */}
      {metadata?.series?.name ? (
        <View style={styles.seriesCard}>
          <View style={styles.seriesHeader}>
            <Ionicons name="library-outline" size={15} color="#A78BFA" style={{ marginRight: 6 }} />
            <Text style={styles.seriesTitle}>Series</Text>
          </View>
          <Text style={styles.seriesName}>{metadata.series.name}</Text>
          {metadata.series.number != null && (
            <Text style={styles.seriesPart}>
              Part {metadata.series.number}
              {metadata.series.total != null ? ` of ${metadata.series.total}` : ''}
            </Text>
          )}
        </View>
      ) : null}

      {/* Text preview */}
      {!file.is_image && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Text Preview</Text>
          {textLoading ? (
            <ActivityIndicator color="#4A9EFF" style={{ paddingVertical: 20 }} />
          ) : textPreview ? (
            <>
              <Text style={styles.previewText} selectable>{textPreview}</Text>
              {text!.length > 1200 && (
                <TouchableOpacity
                  style={styles.expandBtn}
                  onPress={() => setTextExpanded((v) => !v)}
                >
                  <Text style={styles.expandBtnText}>
                    {textExpanded ? 'Show less' : `Show more (${text!.length.toLocaleString()} chars)`}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text style={styles.noText}>No text content available for this file.</Text>
          )}
        </View>
      )}

      {/* Share button */}
      <TouchableOpacity
        style={[styles.shareBtn, sharing && styles.disabled]}
        onPress={handleShare}
        disabled={sharing}
      >
        {sharing ? (
          <ActivityIndicator color="#E8E8E8" />
        ) : (
          <>
            <Ionicons name="share-outline" size={18} color="#E8E8E8" style={{ marginRight: 8 }} />
            <Text style={styles.shareBtnText}>Share</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F0F' },
  content: { padding: 20, paddingBottom: 60 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F0F0F',
    padding: 40,
  },
  errorText: { color: '#666', fontSize: 15, textAlign: 'center', marginTop: 12 },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  titleIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: '#E8E8E8', lineHeight: 26 },

  summaryCard: {
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#222',
  },
  summaryText: { color: '#AAA', fontSize: 14, lineHeight: 22 },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  tag: {
    backgroundColor: '#1E2B3A',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: { color: '#4A9EFF', fontSize: 12, fontWeight: '500' },

  metaCard: {
    backgroundColor: '#141414',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 20,
    overflow: 'hidden',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  metaIcon: { marginRight: 10 },
  metaLabel: { width: 80, fontSize: 13, color: '#666', fontWeight: '500' },
  metaValue: { flex: 1, fontSize: 13, color: '#CCC' },

  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  previewText: {
    fontSize: 13,
    color: '#AAA',
    lineHeight: 21,
    backgroundColor: '#141414',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  expandBtn: { marginTop: 8, alignItems: 'center', paddingVertical: 6 },
  expandBtnText: { color: '#4A9EFF', fontSize: 13, fontWeight: '600' },
  noText: { color: '#555', fontSize: 13, fontStyle: 'italic' },

  seriesCard: {
    backgroundColor: '#12101E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2D1F4E',
    padding: 14,
    marginBottom: 20,
  },
  seriesHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  seriesTitle: { fontSize: 12, fontWeight: '600', color: '#A78BFA', textTransform: 'uppercase', letterSpacing: 0.5 },
  seriesName: { fontSize: 14, color: '#CCC', fontWeight: '600', marginBottom: 4 },
  seriesPart: { fontSize: 12, color: '#777' },

  shareBtn: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  shareBtnText: { color: '#E8E8E8', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
