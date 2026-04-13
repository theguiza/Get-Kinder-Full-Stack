import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useRoute} from '@react-navigation/native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {fetchEvent, rsvpEvent} from '../api/events';
import theme from '../constants/theme';
import {useAuth} from '../context/AuthContext';

const cardBase = {
  backgroundColor: '#ffffff',
  borderRadius: 14,
  padding: 16,
  marginBottom: 12,
  shadowColor: '#000',
  shadowOffset: {width: 0, height: 1},
  shadowOpacity: 0.06,
  shadowRadius: 4,
  elevation: 2,
};

function formatEventDate(iso, tz) {
  if (!iso) {
    return 'Date TBD';
  }

  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz || 'UTC',
    });
  } catch {
    return iso;
  }
}

function formatSummaryLine(startAt, endAt, tz, locationText) {
  const location = locationText || 'Location TBD';
  if (!startAt) {
    return location;
  }

  try {
    const zone = tz || 'America/Vancouver';
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) {
      return location;
    }

    const startLabel = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone,
    }).format(start);

    const end = endAt ? new Date(endAt) : null;
    const endLabel =
      end && !Number.isNaN(end.getTime())
        ? new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: zone,
          }).format(end)
        : 'Time TBD';

    return `${startLabel} - ${endLabel} · ${location}`;
  } catch {
    return location;
  }
}

function getSafetyNotesText(eventData) {
  const candidates = [
    eventData?.safety_notes,
    eventData?.safetyNotes,
    eventData?.safety_note,
    eventData?.safetyNote,
  ];
  const hit = candidates.find(
    value => typeof value === 'string' && value.trim(),
  );
  return hit ? String(hit).trim() : '';
}

function getEventTypeBadge(eventType) {
  if (eventType === 'parent') {
    return {
      label: 'Multi-role',
      badgeStyle: styles.eventTypeParent,
      textStyle: styles.eventTypeParentText,
    };
  }

  if (eventType === 'recurring') {
    return {
      label: 'Recurring',
      badgeStyle: styles.eventTypeRecurring,
      textStyle: styles.eventTypeRecurringText,
    };
  }

  return null;
}

function DetailField({label, value}) {
  return (
    <View style={styles.detailField}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export default function EventDetailScreen() {
  const route = useRoute();
  const {token} = useAuth();
  const eventId = route.params?.eventId;
  const [evt, setEvt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [rsvpState, setRsvpState] = useState(null);
  const [rsvpMessage, setRsvpMessage] = useState('');
  const [safetyModalVisible, setSafetyModalVisible] = useState(false);
  const toastTimerRef = useRef(null);

  const loadEvent = useCallback(async () => {
    try {
      if (!eventId) {
        throw new Error('Missing event ID');
      }

      setError('');
      const json = await fetchEvent(eventId, token);
      setEvt(json.data || null);
    } catch (err) {
      setError(err.message || 'Unable to load event');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventId, token]);

  useEffect(() => {
    loadEvent();
  }, [loadEvent]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadEvent();
  }, [loadEvent]);

  const handleRsvp = useCallback(
    async action => {
      try {
        setRsvpState('loading');
        setRsvpMessage('');

        const json = await rsvpEvent(eventId, action, token);
        const nextStatus = json?.data?.status || null;
        const nextCounts = json?.data?.rsvp_counts || evt?.rsvp_counts || null;

        setEvt(currentEvent => {
          if (!currentEvent) {
            return currentEvent;
          }

          return {
            ...currentEvent,
            viewer_rsvp_status: nextStatus,
            rsvp_counts: nextCounts,
          };
        });

        setRsvpState('success');
        setRsvpMessage(
          action === 'decline' ? 'Request cancelled.' : "You're signed up!",
        );
      } catch (err) {
        setRsvpState('error');
        setRsvpMessage(err.message || 'Unable to update RSVP');
      } finally {
        if (toastTimerRef.current) {
          clearTimeout(toastTimerRef.current);
        }

        toastTimerRef.current = setTimeout(() => {
          setRsvpState(null);
          setRsvpMessage('');
        }, 3000);
      }
    },
    [eventId, evt?.rsvp_counts, token],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={theme.coral} size="large" />
      </SafeAreaView>
    );
  }

  if (error || !evt) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>{error || 'Unable to load event'}</Text>
        <TouchableOpacity onPress={loadEvent} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const badge = getEventTypeBadge(evt.event_type);
  const summaryLine = formatSummaryLine(
    evt.start_at,
    evt.end_at,
    evt.tz,
    evt.location_text,
  );
  const safetyNotesText = getSafetyNotesText(evt);
  const viewerRsvpStatus = String(evt.viewer_rsvp_status || '').toLowerCase();
  const attendanceRequested = ['pending', 'accepted', 'checked_in', 'waitlisted'].includes(
    viewerRsvpStatus,
  );
  const acceptedCount = Number(evt?.rsvp_counts?.accepted) || 0;
  const capacity = Number(evt?.capacity);
  const eventAtCapacity =
    capacity > 0 && acceptedCount >= capacity;
  const waitlistEnabled = evt.waitlist_enabled !== false;

  let rsvpStatusText = 'Request a spot at this event.';
  if (viewerRsvpStatus === 'waitlisted') {
    rsvpStatusText =
      "You're on the waitlist. We'll notify you if a spot opens.";
  } else if (viewerRsvpStatus === 'pending') {
    rsvpStatusText = 'You have requested attending this event.';
  } else if (attendanceRequested) {
    rsvpStatusText = "You're signed up for this event.";
  } else if (eventAtCapacity && waitlistEnabled) {
    rsvpStatusText = 'This event is full. Join the waitlist?';
  } else if (eventAtCapacity && !waitlistEnabled) {
    rsvpStatusText = 'This event is currently full.';
  }

  const spotsValue = `${acceptedCount} / ${
    Number.isFinite(capacity) && capacity > 0 ? capacity : '∞'
  }`;
  const impactCreditsRate =
    evt.impact_credits_rate !== null && evt.impact_credits_rate !== undefined
      ? evt.impact_credits_rate
      : evt.impact_credits_base !== null && evt.impact_credits_base !== undefined
        ? evt.impact_credits_base
        : 10;
  const impactCreditsEstimate =
    evt.impact_credits_estimate !== null && evt.impact_credits_estimate !== undefined
      ? evt.impact_credits_estimate
      : impactCreditsRate;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.coral}
          />
        }>
        {evt.cover_url ? (
          <Image
            source={{uri: evt.cover_url}}
            resizeMode="cover"
            style={styles.coverImage}
          />
        ) : null}

        <View style={styles.titleRow}>
          <Text style={styles.title}>{evt.title || 'Untitled Event'}</Text>
          {badge ? (
            <View style={[styles.eventTypeBadge, badge.badgeStyle]}>
              <Text style={[styles.eventTypeBadgeText, badge.textStyle]}>
                {badge.label}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.summaryLine}>{summaryLine}</Text>

        {!evt.viewer_is_host ? (
          <View style={styles.card}>
            <Text style={styles.rsvpStatusText}>{rsvpStatusText}</Text>

            {!attendanceRequested ? (
              <TouchableOpacity
                disabled={rsvpState === 'loading'}
                onPress={() => handleRsvp('accept')}
                style={[
                  styles.primaryButton,
                  rsvpState === 'loading' ? styles.primaryButtonDisabled : null,
                ]}>
                <Text style={styles.primaryButtonText}>
                  {rsvpState === 'loading'
                    ? 'Saving…'
                    : eventAtCapacity && waitlistEnabled
                      ? 'Join Waitlist'
                      : 'Request Spot'}
                </Text>
              </TouchableOpacity>
            ) : null}

            {rsvpState === 'success' || rsvpState === 'error' ? (
              <View
                style={[
                  styles.rsvpMessageBanner,
                  rsvpState === 'success'
                    ? styles.rsvpMessageSuccess
                    : styles.rsvpMessageError,
                ]}>
                <Text
                  style={[
                    styles.rsvpMessageText,
                    rsvpState === 'success'
                      ? styles.rsvpMessageSuccessText
                      : styles.rsvpMessageErrorText,
                  ]}>
                  {rsvpMessage}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Event Details</Text>

          <View style={styles.detailsGrid}>
            <View style={styles.detailsColumnLeft}>
              <DetailField
                label="Organisation"
                value={evt.org_name || 'Independent'}
              />
              <DetailField
                label="Community"
                value={evt.community_tag || 'General'}
              />
            </View>

            <View style={styles.detailsColumnRight}>
              <DetailField
                label="Impact Credits"
                value={`${impactCreditsRate} IC/hr · ~${impactCreditsEstimate} IC`}
              />
              <DetailField label="Spots" value={spotsValue} />
            </View>
          </View>

          {Array.isArray(evt.cause_tags) && evt.cause_tags.length > 0 ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.detailLabel}>Cause Tags</Text>
              <View style={styles.tagsRow}>
                {evt.cause_tags.map(tag => (
                  <View key={String(tag)} style={styles.tagPill}>
                    <Text style={styles.tagPillText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {evt.description ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.detailLabel}>Description</Text>
              <Text style={styles.bodyText}>{evt.description}</Text>
            </View>
          ) : null}

          {evt.requirements ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.detailLabel}>Requirements</Text>
              <Text style={styles.bodyText}>{evt.requirements}</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={() => setSafetyModalVisible(true)}
          style={styles.safetyButton}>
          <Text style={styles.safetyButtonText}>Safety Notes</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>When / Where</Text>
          <DetailField
            label="Date & Time"
            value={formatEventDate(evt.start_at, evt.tz)}
          />
          <DetailField
            label="Location"
            value={evt.location_text || 'Location TBD'}
          />
        </View>
      </ScrollView>

      <Modal
        animationType="slide"
        transparent={true}
        visible={safetyModalVisible}
        onRequestClose={() => setSafetyModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable
            onPress={() => setSafetyModalVisible(false)}
            style={styles.modalBackdropPress}
          />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Safety Notes</Text>
            <Text style={styles.modalBody}>
              {safetyNotesText || 'No safety notes provided for this event.'}
            </Text>
            <TouchableOpacity
              onPress={() => setSafetyModalVisible(false)}
              style={styles.modalCloseButton}>
              <Text style={styles.modalCloseButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bodyText: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  card: {
    ...cardBase,
  },
  cardTitle: {
    borderBottomColor: '#f0f0f0',
    borderBottomWidth: 1,
    color: theme.slate,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    paddingBottom: 10,
  },
  centered: {
    alignItems: 'center',
    backgroundColor: theme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  coverImage: {
    borderRadius: 14,
    height: 200,
    marginBottom: 16,
    width: '100%',
  },
  detailField: {
    marginBottom: 12,
  },
  detailLabel: {
    color: '#8d9099',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  detailValue: {
    color: theme.slate,
    fontSize: 14,
    fontWeight: '600',
  },
  detailsColumnLeft: {
    flex: 1,
    marginRight: 6,
  },
  detailsColumnRight: {
    flex: 1,
    marginLeft: 6,
  },
  detailsGrid: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  errorText: {
    color: '#c8342f',
    fontSize: 14,
    textAlign: 'center',
  },
  eventTypeBadge: {
    borderRadius: 6,
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  eventTypeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  eventTypeParent: {
    backgroundColor: '#e8f0fe',
  },
  eventTypeParentText: {
    color: '#1a56db',
  },
  eventTypeRecurring: {
    backgroundColor: '#fef3c7',
  },
  eventTypeRecurringText: {
    color: '#92400e',
  },
  modalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdropPress: {
    flex: 1,
  },
  modalBody: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 22,
  },
  modalCloseButton: {
    alignItems: 'center',
    backgroundColor: theme.coral,
    borderRadius: 10,
    marginTop: 20,
    padding: 12,
  },
  modalCloseButtonText: {
    color: theme.white,
    fontSize: 14,
    fontWeight: '700',
  },
  modalSheet: {
    backgroundColor: theme.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
  },
  modalTitle: {
    color: theme.slate,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: theme.coral,
    borderRadius: 10,
    padding: 12,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: theme.white,
    fontSize: 14,
    fontWeight: '700',
  },
  retryButton: {
    backgroundColor: theme.coral,
    borderRadius: 10,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  retryButtonText: {
    color: theme.white,
    fontSize: 14,
    fontWeight: '700',
  },
  rsvpMessageBanner: {
    borderRadius: 8,
    marginTop: 8,
    padding: 10,
  },
  rsvpMessageError: {
    backgroundColor: '#fef2f2',
  },
  rsvpMessageErrorText: {
    color: '#b91c1c',
  },
  rsvpMessageSuccess: {
    backgroundColor: '#ecfdf5',
  },
  rsvpMessageSuccessText: {
    color: '#065f46',
  },
  rsvpMessageText: {
    fontSize: 13,
  },
  rsvpStatusText: {
    color: '#8d9099',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  safeArea: {
    backgroundColor: theme.background,
    flex: 1,
  },
  safetyButton: {
    alignItems: 'center',
    borderColor: '#d1d5db',
    borderRadius: 10,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  safetyButtonText: {
    color: theme.slate,
    fontSize: 14,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionBlock: {
    marginBottom: 12,
  },
  summaryLine: {
    color: theme.slate,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
  },
  tagPill: {
    borderColor: theme.slate,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 6,
    marginRight: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  tagPillText: {
    color: theme.slate,
    fontSize: 12,
    fontWeight: '500',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  title: {
    color: theme.coral,
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    marginRight: 8,
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    marginBottom: 10,
  },
});
