import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {API_BASE_URL} from '@env';
import {useAuth} from '../context/AuthContext';
import theme from '../constants/theme';

function QueueCard({item, isSelected, onPress}) {
  const date = item?.startTime
    ? new Date(item.startTime).toLocaleDateString('en-CA', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : '';
  const capacityText = item?.capacity
    ? ` / ${item.capacity} spots`
    : '';

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onPress(item.opportunityId)}
      style={[
        styles.queueCard,
        item?.pendingCount > 0 ? styles.queueCardAttention : styles.queueCardDefault,
        isSelected ? styles.queueCardSelected : null,
      ]}>
      <View style={styles.queueCardHeader}>
        <Text style={styles.queueCardTitle} numberOfLines={2}>
          {item?.opportunityName || 'Opportunity'}
        </Text>
        {item?.pendingCount > 0 ? (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>
              {item.pendingCount} pending
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.queueCardDate}>{date}</Text>
      <Text style={styles.queueCardMeta}>
        {item?.approvedCount ?? 0}
        {' approved'}
        {capacityText}
      </Text>
    </TouchableOpacity>
  );
}

function ApplicantRow({applicant, onApprove, onDecline, actionLoading}) {
  const displayName =
    `${applicant?.firstname || ''} ${applicant?.lastname || ''}`.trim() ||
    'Volunteer';
  const rsvpStatus = String(applicant?.rsvpStatus || '').toLowerCase();
  const isApproved = ['accepted', 'checked_in', 'verified'].includes(rsvpStatus);
  const isPending = rsvpStatus === 'pending';

  let badgeStyle = styles.statusBadgeNeutral;
  let badgeTextStyle = styles.statusBadgeNeutralText;
  let badgeLabel = rsvpStatus || 'unknown';

  if (isPending) {
    badgeStyle = styles.statusBadgePending;
    badgeTextStyle = styles.statusBadgePendingText;
    badgeLabel = 'Pending';
  } else if (isApproved) {
    badgeStyle = styles.statusBadgeApproved;
    badgeTextStyle = styles.statusBadgeApprovedText;
    badgeLabel = 'Approved';
  }

  return (
    <View style={styles.applicantCard}>
      <View style={styles.applicantHeader}>
        <Text style={styles.applicantName} numberOfLines={1}>
          {displayName}
        </Text>
        <View style={[styles.statusBadge, badgeStyle]}>
          <Text style={[styles.statusBadgeText, badgeTextStyle]}>
            {badgeLabel}
          </Text>
        </View>
      </View>

      <Text style={styles.applicantMeta}>
        {applicant?.pastShifts ?? 0}
        {' past shifts · '}
        {applicant?.reliabilityScore ?? 0}
        {' reliability · '}
        {applicant?.priorityTier || 'Standard'}
      </Text>

      {isPending ? (
        <View style={styles.actionRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={actionLoading !== null}
            onPress={onApprove}
            style={[
              styles.actionButton,
              styles.approveButton,
              actionLoading !== null ? styles.actionButtonDisabled : null,
            ]}>
            <Text style={styles.approveButtonText}>
              {actionLoading === 'approve' ? 'Approving…' : 'Approve'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            disabled={actionLoading !== null}
            onPress={onDecline}
            style={[
              styles.actionButton,
              styles.declineButton,
              actionLoading !== null ? styles.actionButtonDisabled : null,
            ]}>
            <Text style={styles.declineButtonText}>
              {actionLoading === 'decline' ? 'Declining…' : 'Decline'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

export default function OrgPortalScreen() {
  const {token} = useAuth();
  const [kpis, setKpis] = useState(null);
  const [queue, setQueue] = useState(null);
  const [applicants, setApplicants] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(true);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [actionLoadingByUser, setActionLoadingByUser] = useState({});

  const fetchKpis = useCallback(async () => {
    try {
      setKpisLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/org/kpis`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Unable to load org KPIs');
      }
      setKpis(json);
    } finally {
      setKpisLoading(false);
    }
  }, [token]);

  const fetchQueue = useCallback(async () => {
    try {
      setQueueLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/org/queue`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Unable to load org queue');
      }
      setQueue(json);
    } finally {
      setQueueLoading(false);
    }
  }, [token]);

  const fetchApplicants = useCallback(async (eventId, {showLoading = true} = {}) => {
    try {
      if (showLoading) {
        setApplicantsLoading(true);
      }
      const response = await fetch(
        `${API_BASE_URL}/api/org/opportunities/${eventId}/applicants`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Unable to load applicants');
      }
      setApplicants(Array.isArray(json?.applicants) ? json.applicants : []);
    } finally {
      setApplicantsLoading(false);
    }
  }, [token]);

  const fetchScreenData = useCallback(async () => {
    try {
      setError('');
      await Promise.all([fetchKpis(), fetchQueue()]);
    } catch (err) {
      setError(err.message || 'Unable to load org portal');
    }
  }, [fetchKpis, fetchQueue]);

  useEffect(() => {
    fetchScreenData();
  }, [fetchScreenData]);

  useEffect(() => {
    if (!selectedEventId) {
      setApplicants([]);
      setApplicantsLoading(false);
      return;
    }

    async function loadApplicants() {
      try {
        setError('');
        setApplicants([]);
        await fetchApplicants(selectedEventId);
      } catch (err) {
        setError(err.message || 'Unable to load applicants');
      }
    }

    loadApplicants();
  }, [fetchApplicants, selectedEventId]);

  const onRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      setError('');
      await fetchScreenData();
      if (selectedEventId) {
        await fetchApplicants(selectedEventId, {showLoading: false});
      }
    } catch (err) {
      setError(err.message || 'Unable to refresh org portal');
    } finally {
      setRefreshing(false);
    }
  }, [fetchApplicants, fetchScreenData, selectedEventId]);

  const handleApplicantAction = useCallback(async (eventId, userId, action) => {
    try {
      setActionLoadingByUser(current => ({
        ...current,
        [userId]: action,
      }));

      const response = await fetch(
        `${API_BASE_URL}/api/org/opportunities/${eventId}/applicants/${userId}/${action}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Action failed. Try again.');
      }
      await fetchApplicants(eventId, {showLoading: false});
    } catch (err) {
      Alert.alert('Error', err.message || 'Action failed. Try again.');
    } finally {
      setActionLoadingByUser(current => ({
        ...current,
        [userId]: null,
      }));
    }
  }, [fetchApplicants, token]);

  const onApprove = useCallback((eventId, userId) => {
    handleApplicantAction(eventId, userId, 'approve');
  }, [handleApplicantAction]);

  const onDecline = useCallback((eventId, userId) => {
    handleApplicantAction(eventId, userId, 'decline');
  }, [handleApplicantAction]);

  const hasInitialData = kpis !== null || queue !== null;
  const isFirstLoad = !hasInitialData && kpisLoading && queueLoading;
  const needsAttention = Array.isArray(queue?.needsAttention) ? queue.needsAttention : [];
  const upcoming = Array.isArray(queue?.upcoming) ? queue.upcoming : [];
  const active = Array.isArray(queue?.active) ? queue.active : [];

  if (isFirstLoad) {
    return (
      <SafeAreaView
        style={styles.centered}
        edges={['top', 'left', 'right']}>
        <ActivityIndicator color={theme.coral} size="large" />
      </SafeAreaView>
    );
  }

  if (!hasInitialData && error) {
    return (
      <SafeAreaView
        style={styles.centered}
        edges={['top', 'left', 'right']}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={['top', 'left', 'right']}>
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
        <Text style={styles.header}>Org Portal</Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={[styles.kpiValue, styles.kpiValueSlate]}>
              {kpis?.totalHours ?? 0} hrs
            </Text>
            <Text style={styles.kpiLabel}>Total Hours</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={[styles.kpiValue, styles.kpiValueSlate]}>
              {kpis?.fillRate ?? 0}%
            </Text>
            <Text style={styles.kpiLabel}>Fill Rate</Text>
          </View>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={[styles.kpiValue, styles.kpiValuePositive]}>
              {kpis?.impactCredits ?? 0}
            </Text>
            <Text style={styles.kpiLabel}>Impact Credits</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text
              style={[
                styles.kpiValue,
                Number(kpis?.noShowRate) > 10
                  ? styles.kpiValueDanger
                  : styles.kpiValuePositive,
              ]}>
              {kpis?.noShowRate ?? 0}%
            </Text>
            <Text style={styles.kpiLabel}>No-Show Rate</Text>
          </View>
        </View>

        {needsAttention.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, styles.sectionLabelCoral]}>
              NEEDS ATTENTION
            </Text>
            {needsAttention.map(item => (
              <QueueCard
                key={item.opportunityId}
                item={item}
                isSelected={selectedEventId === item.opportunityId}
                onPress={setSelectedEventId}
              />
            ))}
          </View>
        ) : null}

        {upcoming.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, styles.sectionLabelSlate]}>
              UPCOMING
            </Text>
            {upcoming.map(item => (
              <QueueCard
                key={item.opportunityId}
                item={item}
                isSelected={selectedEventId === item.opportunityId}
                onPress={setSelectedEventId}
              />
            ))}
          </View>
        ) : null}

        {active.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, styles.sectionLabelPositive]}>
              ACTIVE NOW
            </Text>
            {active.map(item => (
              <QueueCard
                key={item.opportunityId}
                item={item}
                isSelected={selectedEventId === item.opportunityId}
                onPress={setSelectedEventId}
              />
            ))}
          </View>
        ) : null}

        {queue && !needsAttention.length && !upcoming.length && !active.length ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🏢</Text>
            <Text style={styles.emptyTitle}>No opportunities posted yet.</Text>
            <Text style={styles.emptySubtitle}>
              Create opportunities on the web portal.
            </Text>
          </View>
        ) : null}

        {selectedEventId ? (
          <View style={styles.applicantsSection}>
            <View style={styles.applicantsHeader}>
              <Text style={styles.applicantsTitle}>Applicants</Text>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setSelectedEventId(null)}>
                <Text style={styles.closeText}>✕ Close</Text>
              </TouchableOpacity>
            </View>

            {applicantsLoading ? (
              <ActivityIndicator
                color={theme.coral}
                size="small"
                style={styles.applicantsLoader}
              />
            ) : null}

            {!applicantsLoading && applicants.length === 0 ? (
              <Text style={styles.noApplicantsText}>No applicants yet.</Text>
            ) : null}

            {!applicantsLoading
              ? applicants.map(applicant => (
                  <ApplicantRow
                    key={applicant.userId}
                    applicant={applicant}
                    actionLoading={actionLoadingByUser[applicant.userId] || null}
                    onApprove={() => onApprove(selectedEventId, applicant.userId)}
                    onDecline={() => onDecline(selectedEventId, applicant.userId)}
                  />
                ))
              : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    borderRadius: 8,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionButtonDisabled: {
    opacity: 0.7,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  applicantCard: {
    backgroundColor: theme.white,
    borderRadius: 12,
    marginBottom: 8,
    padding: 12,
  },
  applicantHeader: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  applicantMeta: {
    color: '#8d9099',
    fontSize: 11,
    marginTop: 4,
  },
  applicantName: {
    color: theme.text,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  applicantsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 24,
  },
  applicantsLoader: {
    alignSelf: 'center',
    marginVertical: 16,
  },
  applicantsSection: {
    marginTop: 4,
  },
  applicantsTitle: {
    color: theme.slate,
    fontSize: 16,
    fontWeight: '700',
  },
  approveButton: {
    backgroundColor: theme.coral,
  },
  approveButtonText: {
    color: theme.white,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  centered: {
    alignItems: 'center',
    backgroundColor: theme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  closeText: {
    color: '#8d9099',
    fontSize: 13,
  },
  declineButton: {
    backgroundColor: theme.white,
    borderColor: '#e5e7eb',
    borderWidth: 1,
  },
  declineButtonText: {
    color: '#c8342f',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: theme.white,
    borderRadius: 14,
    marginTop: 16,
    padding: 24,
  },
  emptySubtitle: {
    color: '#8d9099',
    fontSize: 13,
    textAlign: 'center',
  },
  emptyTitle: {
    color: theme.slate,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorText: {
    color: '#c8342f',
    fontSize: 14,
    textAlign: 'center',
  },
  header: {
    color: theme.slate,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 16,
  },
  kpiCard: {
    alignItems: 'center',
    backgroundColor: theme.white,
    borderRadius: 12,
    flex: 1,
    marginBottom: 8,
    marginHorizontal: 4,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  kpiLabel: {
    color: '#8d9099',
    fontSize: 10,
    marginTop: 3,
    textAlign: 'center',
  },
  kpiRow: {
    flexDirection: 'row',
    marginHorizontal: -4,
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  kpiValueDanger: {
    color: '#c8342f',
  },
  kpiValuePositive: {
    color: '#2db36f',
  },
  kpiValueSlate: {
    color: theme.slate,
  },
  noApplicantsText: {
    color: '#8d9099',
    fontSize: 14,
    textAlign: 'center',
  },
  pendingBadge: {
    backgroundColor: theme.coral,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pendingBadgeText: {
    color: theme.white,
    fontSize: 11,
    fontWeight: '700',
  },
  queueCard: {
    backgroundColor: theme.white,
    borderLeftWidth: 4,
    borderRadius: 14,
    marginBottom: 10,
    padding: 14,
  },
  queueCardAttention: {
    borderLeftColor: theme.coral,
  },
  queueCardDate: {
    color: '#8d9099',
    fontSize: 12,
    marginTop: 4,
  },
  queueCardDefault: {
    borderLeftColor: theme.slate,
  },
  queueCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  queueCardMeta: {
    color: theme.slate,
    fontSize: 12,
    marginTop: 2,
  },
  queueCardSelected: {
    backgroundColor: '#fff6f6',
  },
  queueCardTitle: {
    color: theme.text,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    marginRight: 8,
  },
  safeArea: {
    backgroundColor: theme.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginTop: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  sectionLabelCoral: {
    color: theme.coral,
  },
  sectionLabelPositive: {
    color: '#2db36f',
  },
  sectionLabelSlate: {
    color: theme.slate,
  },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  statusBadgeApproved: {
    backgroundColor: '#d4edda',
  },
  statusBadgeApprovedText: {
    color: '#1a7f4b',
  },
  statusBadgeNeutral: {
    backgroundColor: '#f0f0f0',
  },
  statusBadgeNeutralText: {
    color: '#8d9099',
  },
  statusBadgePending: {
    backgroundColor: '#fff7ec',
  },
  statusBadgePendingText: {
    color: '#8c5a00',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
