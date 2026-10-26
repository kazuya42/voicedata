// Transkript-Liste: gespeicherte Voicememos ansehen, in den Bestell-Flow laden, löschen.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CheckCircle2, FileText, Trash2 } from 'lucide-react-native';
import { deleteAllTranscripts, deleteTranscript, listTranscripts } from '../lib/transcripts';
import { TARGET_LABELS, Transcript } from '../lib/types';

export default function TranscriptsScreen(props: {
  refreshKey: number;
  onLoadTranscript: (t: Transcript) => void;
}) {
  const [items, setItems] = useState<Transcript[]>([]);

  const refresh = useCallback(() => {
    listTranscripts().then(setItems);
  }, []);

  useEffect(refresh, [refresh, props.refreshKey]);

  const confirmDelete = (t: Transcript) => {
    Alert.alert(
      'Transkript löschen?',
      `„${t.fields.customerName || 'Ohne Name'}" vom ${formatDate(t.createdAt)} wird endgültig gelöscht.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            await deleteTranscript(t.id);
            refresh();
          },
        },
      ],
    );
  };

  const confirmDeleteAll = () => {
    if (items.length === 0) return;
    Alert.alert('Alle löschen?', `${items.length} Transkripte werden endgültig gelöscht.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Alle löschen',
        style: 'destructive',
        onPress: async () => {
          await deleteAllTranscripts();
          refresh();
        },
      },
    ]);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('de-DE')} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  };

  if (items.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <FileText size={40} color="#334155" />
        <Text style={styles.emptyText}>Noch keine Transkripte gespeichert.</Text>
        <Text style={styles.emptySubtext}>Jede Aufnahme wird hier automatisch abgelegt.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => props.onLoadTranscript(item)}>
            <View style={{ flex: 1 }}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.fields.customerName || 'Ohne Name'}
                </Text>
                {item.status === 'sent' ? (
                  <View style={styles.badgeSent}>
                    <CheckCircle2 size={11} color="#10B981" style={{ marginRight: 4 }} />
                    <Text style={styles.badgeSentText}>
                      {item.sentTarget ? TARGET_LABELS[item.sentTarget] : 'Gesendet'}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.badgeDraft}>
                    <Text style={styles.badgeDraftText}>ENTWURF</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardSubtitle} numberOfLines={1}>
                {item.fields.quantity}x{' '}
                {item.fields.productName || item.fields.productNumber || 'Kein Produkt'}
              </Text>
              <Text style={styles.cardMeta}>
                {formatDate(item.createdAt)}
                {item.resultInfo ? ` · ${item.resultInfo}` : ''}
              </Text>
              <Text style={styles.cardTranscript} numberOfLines={2}>
                {`„${item.transcriptText}“`}
              </Text>
            </View>
            <TouchableOpacity style={styles.deleteBtn} onPress={() => confirmDelete(item)}>
              <Trash2 size={18} color="#F87171" />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.deleteAllBtn} onPress={confirmDeleteAll}>
        <Trash2 size={14} color="#F87171" style={{ marginRight: 6 }} />
        <Text style={styles.deleteAllText}>Alle löschen</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: { color: '#94A3B8', fontSize: 15, fontWeight: '600', marginTop: 14 },
  emptySubtext: { color: '#64748B', fontSize: 13, marginTop: 4, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: '#F8FAFC', fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  cardSubtitle: { color: '#CBD5E1', fontSize: 13, marginTop: 3 },
  cardMeta: { color: '#64748B', fontSize: 11, marginTop: 3 },
  cardTranscript: { color: '#64748B', fontSize: 12, fontStyle: 'italic', marginTop: 6 },
  badgeSent: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  badgeSentText: { color: '#10B981', fontSize: 10, fontWeight: '700' },
  badgeDraft: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  badgeDraftText: { color: '#A5B4FC', fontSize: 10, fontWeight: '700' },
  deleteBtn: { justifyContent: 'center', paddingLeft: 12 },
  deleteAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  deleteAllText: { color: '#F87171', fontSize: 13, fontWeight: '600' },
});
