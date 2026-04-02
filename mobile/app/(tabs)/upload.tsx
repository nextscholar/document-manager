/**
 * Upload screen.
 *
 * Users can add documents via three methods:
 *   1. Document picker (any file type)
 *   2. Photo library
 *   3. Camera capture
 *
 * Picked files are staged in a list and uploaded together.
 * Share-from-other-apps is handled by the deep-link / intent filter
 * configured in app.json; the actual file handling is wired up via
 * expo-router's universal linking (see the root _layout.tsx).
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { uploadFiles } from '../../src/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingFile {
  key: string;
  uri: string;
  name: string;
  type: string;
  size?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_FILES = 10;
const MAX_BYTES = 1 * 1024 * 1024; // 1 MB per file (matches backend limit)

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function UploadScreen() {
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ count: number; names: string[] } | null>(null);

  // -------------------------------------------------------------------------
  // Add files helpers
  // -------------------------------------------------------------------------

  function addFiles(incoming: PendingFile[]) {
    setResult(null);
    const rejected: string[] = [];
    const valid: PendingFile[] = [];

    for (const f of incoming) {
      if (f.size != null && f.size > MAX_BYTES) {
        rejected.push(`"${f.name}" exceeds the 1 MB limit.`);
        continue;
      }
      if (pending.some((p) => p.uri === f.uri)) {
        rejected.push(`"${f.name}" is already in the queue.`);
        continue;
      }
      valid.push(f);
    }

    if (rejected.length) {
      Alert.alert('Some files were skipped', rejected.join('\n'));
    }

    setPending((prev) => {
      const combined = [...prev, ...valid];
      if (combined.length > MAX_FILES) {
        Alert.alert(`Maximum ${MAX_FILES} files`, `Only the first ${MAX_FILES} files were added.`);
        return combined.slice(0, MAX_FILES);
      }
      return combined;
    });
  }

  // -------------------------------------------------------------------------
  // Picker handlers
  // -------------------------------------------------------------------------

  const pickDocuments = useCallback(async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;

      const files: PendingFile[] = picked.assets.map((a) => ({
        key: a.uri,
        uri: a.uri,
        name: a.name,
        type: a.mimeType ?? 'application/octet-stream',
        size: a.size,
      }));
      addFiles(files);
    } catch {
      Alert.alert('Error', 'Failed to pick documents.');
    }
  }, [pending]);

  const pickFromLibrary = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your photo library to upload images.');
      return;
    }
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.85,
        exif: false,
      });
      if (picked.canceled) return;

      const files: PendingFile[] = picked.assets.map((a) => ({
        key: a.uri,
        uri: a.uri,
        name: a.fileName ?? `photo_${Date.now()}.jpg`,
        type: a.mimeType ?? 'image/jpeg',
        size: a.fileSize,
      }));
      addFiles(files);
    } catch {
      Alert.alert('Error', 'Failed to pick from library.');
    }
  }, [pending]);

  const capturePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow camera access to capture documents.');
      return;
    }
    try {
      const picked = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        exif: false,
      });
      if (picked.canceled) return;

      const asset = picked.assets[0];
      addFiles([
        {
          key: asset.uri,
          uri: asset.uri,
          name: asset.fileName ?? `capture_${Date.now()}.jpg`,
          type: asset.mimeType ?? 'image/jpeg',
          size: asset.fileSize,
        },
      ]);
    } catch {
      Alert.alert('Error', 'Failed to capture photo.');
    }
  }, [pending]);

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  const handleUpload = useCallback(async () => {
    if (!pending.length) return;
    setUploading(true);
    try {
      const res = await uploadFiles(pending);
      setResult({ count: res.count, names: res.uploaded });
      setPending([]);
    } catch (err: unknown) {
      Alert.alert('Upload failed', (err as Error).message ?? 'Unknown error');
    } finally {
      setUploading(false);
    }
  }, [pending]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  function renderPending({ item }: { item: PendingFile }) {
    return (
      <View style={styles.pendingRow}>
        <Ionicons name="document-outline" size={20} color="#4A9EFF" style={{ marginRight: 10 }} />
        <View style={styles.pendingInfo}>
          <Text style={styles.pendingName} numberOfLines={1}>{item.name}</Text>
          {item.size != null && (
            <Text style={styles.pendingSize}>{formatBytes(item.size)}</Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => setPending((prev) => prev.filter((f) => f.key !== item.key))}
        >
          <Ionicons name="close-circle" size={20} color="#444" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={pickDocuments}>
          <Ionicons name="attach-outline" size={26} color="#4A9EFF" />
          <Text style={styles.actionLabel}>Files</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={pickFromLibrary}>
          <Ionicons name="images-outline" size={26} color="#4A9EFF" />
          <Text style={styles.actionLabel}>Library</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, Platform.OS === 'web' && styles.disabled]}
          onPress={capturePhoto}
          disabled={Platform.OS === 'web'}
        >
          <Ionicons name="camera-outline" size={26} color={Platform.OS === 'web' ? '#444' : '#4A9EFF'} />
          <Text style={[styles.actionLabel, Platform.OS === 'web' && styles.disabledText]}>
            Camera
          </Text>
        </TouchableOpacity>
      </View>

      {/* Success banner */}
      {result && (
        <View style={styles.successBanner}>
          <Ionicons name="checkmark-circle" size={18} color="#3ECF8E" style={{ marginRight: 8 }} />
          <Text style={styles.successText}>
            {result.count} file{result.count !== 1 ? 's' : ''} uploaded successfully
          </Text>
        </View>
      )}

      {/* Pending files list */}
      <FlatList
        data={pending}
        keyExtractor={(item) => item.key}
        renderItem={renderPending}
        ListHeaderComponent={
          pending.length > 0 ? (
            <Text style={styles.sectionTitle}>
              {pending.length} file{pending.length !== 1 ? 's' : ''} queued
            </Text>
          ) : null
        }
        ListEmptyComponent={
          !result ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-upload-outline" size={64} color="#222" />
              <Text style={styles.emptyTitle}>Add files to upload</Text>
              <Text style={styles.emptyHint}>
                Tap Files, Library, or Camera above to select documents.
                Files are limited to 1 MB each.
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* Upload button */}
      {pending.length > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.uploadBtn, uploading && styles.disabled]}
            onPress={handleUpload}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator color="#0F0F0F" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={20} color="#0F0F0F" style={{ marginRight: 8 }} />
                <Text style={styles.uploadBtnText}>
                  Upload {pending.length} file{pending.length !== 1 ? 's' : ''}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F0F' },

  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 24,
    paddingVertical: 24,
    backgroundColor: '#141414',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  actionBtn: {
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    gap: 8,
  },
  actionLabel: { color: '#E8E8E8', fontSize: 13, fontWeight: '600' },

  sectionTitle: {
    fontSize: 13,
    color: '#666',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },

  list: { paddingBottom: 120 },

  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  pendingInfo: { flex: 1, marginRight: 8 },
  pendingName: { fontSize: 14, color: '#E8E8E8', fontWeight: '500' },
  pendingSize: { fontSize: 12, color: '#666', marginTop: 2 },

  separator: { height: 1, backgroundColor: '#1A1A1A', marginLeft: 50 },

  empty: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#555', marginTop: 20 },
  emptyHint: {
    fontSize: 13,
    color: '#444',
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 20,
  },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: '#0F0F0F',
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
  },
  uploadBtn: {
    backgroundColor: '#4A9EFF',
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadBtnText: { color: '#0F0F0F', fontWeight: '700', fontSize: 16 },

  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D2318',
    margin: 16,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1A4030',
  },
  successText: { color: '#3ECF8E', fontSize: 13, flex: 1 },

  disabled: { opacity: 0.4 },
  disabledText: { color: '#444' },
});
