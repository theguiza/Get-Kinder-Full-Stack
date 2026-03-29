import {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
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

const DONATE_URL =
  'https://checkout.square.site/merchant/ML7WXHMB2XEJD/checkout/WBQKBZNKKR4Z5GRIZ42LCYFQ';

const TIER_LABELS = {
  casual: 'Casual Donor',
  impact: 'Impact Donor',
  champion: 'Champion Donor',
};

const TIER_COLORS = {
  casual: '#6b7f9e',
  impact: theme.slate,
  champion: theme.coral,
};

function formatCurrency(cents) {
  return `$${(Math.max(0, Number(cents) || 0) / 100).toFixed(0)}`;
}

function formatHours(minutes) {
  const m = Number(minutes);
  return Number.isFinite(m)
    ? (Math.round((m / 60) * 10) / 10).toFixed(1)
    : '0.0';
}

function formatDate(iso) {
  if (!iso) {
    return '—';
  }
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getMemberSince(iso) {
  if (!iso) {
    return null;
  }
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
  });
}

function StatCard({label, value, valueStyle}) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, valueStyle]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function PreviewCard({label, value}) {
  return (
    <View style={styles.previewCard}>
      <Text style={styles.previewValue}>{value}</Text>
      <Text style={styles.previewLabel}>{label}</Text>
    </View>
  );
}

function TimelineCard({item}) {
  const isFunded = item?.status === 'funded';
  const title = item?.event_title || `Donation #${item?.donation_id ?? '—'}`;
  const dateLine = item?.amount_cents
    ? `${formatDate(item?.donation_date || item?.created_at)} · ${formatCurrency(
        item.amount_cents,
      )}`
    : formatDate(item?.donation_date || item?.created_at);

  return (
    <View
      style={[
        styles.timelineCard,
        isFunded ? styles.timelineCardFunded : styles.timelineCardPending,
      ]}>
      <View style={styles.timelineTopRow}>
        <Text numberOfLines={1} style={styles.timelineTitle}>
          {title}
        </Text>
        <View
          style={[
            styles.timelineBadge,
            isFunded ? styles.timelineBadgeFunded : styles.timelineBadgePending,
          ]}>
          <Text
            style={[
              styles.timelineBadgeText,
              isFunded
                ? styles.timelineBadgeTextFunded
                : styles.timelineBadgeTextPending,
            ]}>
            {isFunded ? 'Funded ✓' : 'Pending'}
          </Text>
        </View>
      </View>
      <Text style={styles.timelineMeta}>{dateLine}</Text>
      {isFunded ? (
        <Text style={styles.timelineDetail}>
          {`${formatHours(item?.minutes_verified)} hrs · ${
            item?.credits_funded ?? 0
          } IC · +${item?.ic_earned ?? 0} IC earned`}
        </Text>
      ) : (
        <Text style={styles.timelinePendingText}>Awaiting verification</Text>
      )}
    </View>
  );
}

export default function ProfileScreen() {
  const {token, user, logout} = useAuth();
  const [summary, setSummary] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [receiptsError, setReceiptsError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      setSummaryError('');
      setSummaryLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/donor/summary`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'Unable to load donor summary');
      }
      setSummary(json.data || {});
    } catch (err) {
      setSummaryError(err.message || 'Unable to load donor summary');
    } finally {
      setSummaryLoading(false);
    }
  }, [token]);

  const fetchReceipts = useCallback(async () => {
    try {
      setReceiptsError('');
      setReceiptsLoading(true);
      const response = await fetch(
        `${API_BASE_URL}/api/donor/receipts?limit=10&offset=0`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'Unable to load receipts');
      }
      setReceipts(Array.isArray(json?.data?.receipts) ? json.data.receipts : []);
    } catch (err) {
      setReceiptsError(err.message || 'Unable to load receipts');
    } finally {
      setReceiptsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchSummary();
    fetchReceipts();
  }, [fetchReceipts, fetchSummary]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchSummary(), fetchReceipts()]);
    setRefreshing(false);
  }, [fetchReceipts, fetchSummary]);

  const handleDonate = useCallback(() => {
    Linking.openURL(DONATE_URL);
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert('Log Out', 'Are you sure?', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Log Out', style: 'destructive', onPress: logout},
    ]);
  }, [logout]);

  if (summaryLoading && !summary) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={theme.coral} size="large" />
      </SafeAreaView>
    );
  }

  if (summaryError) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>{summaryError}</Text>
      </SafeAreaView>
    );
  }

  const d = summary || {};
  const donationCount = Number(d.donation_count) || 0;
  const hasHistory = !summaryLoading && donationCount > 0;
  const isEmpty = !summaryLoading && !summaryError && donationCount === 0;
  const donorTier = d.donor_tier || 'casual';
  const tierLabel = TIER_LABELS[donorTier] || 'Casual Donor';
  const tierColor = TIER_COLORS[donorTier] || '#6b7f9e';
  const memberSince = getMemberSince(d.member_since);
  const displayName = user?.name || user?.firstname || 'Donor';
  const email = user?.email || '';
  const initial = String(displayName).trim().charAt(0).toUpperCase() || 'D';
  const milestoneProgress = Number(d.milestone_progress_hours) || 0;
  const milestoneTarget = Number(d.milestone_target_hours) || 0;
  const pct =
    milestoneTarget > 0
      ? Math.min(100, Math.round((milestoneProgress / milestoneTarget) * 100))
      : 0;
  const remaining = Math.max(0, milestoneTarget - milestoneProgress);
  const tierPillStyle =
    tierColor === theme.slate
      ? styles.tierPillImpact
      : tierColor === theme.coral
        ? styles.tierPillChampion
        : styles.tierPillCasual;

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
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.profileHeaderText}>
            <Text style={styles.displayName}>{displayName}</Text>
            <Text style={styles.email}>{email}</Text>
            <View
              style={[
                styles.tierPill,
                tierPillStyle,
              ]}>
              <Text style={styles.tierPillText}>{tierLabel}</Text>
            </View>
            {memberSince ? (
              <Text style={styles.memberSinceText}>
                Member since {memberSince}
              </Text>
            ) : null}
          </View>
        </View>

        <TouchableOpacity onPress={handleDonate} style={styles.donateButton}>
          <Text style={styles.donateButtonText}>Donate Now</Text>
        </TouchableOpacity>

        {isEmpty ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>❤️</Text>
            <Text style={styles.emptyHeading}>Make your first donation</Text>
            <Text style={styles.emptyBody}>
              Your giving funds verified volunteer work in your community.
              You'll earn Impact Credits and see exactly where every dollar goes.
            </Text>

            <View style={styles.previewRow}>
              <PreviewCard label="verified hours" value="5 hrs" />
              <PreviewCard label="Impact Credits" value="250 IC" />
              <PreviewCard label="$KINDER (soon)" value="25 $K" />
            </View>

            <Text style={styles.previewNote}>
              Based on a $50 donation at 5 IC / $1
            </Text>
          </View>
        ) : null}

        {hasHistory ? (
          <>
            <View style={styles.statsGrid}>
              <View style={styles.statsRow}>
                <StatCard
                  label="Total Donated"
                  value={formatCurrency(d.donated_cents_total)}
                  valueStyle={styles.statValueCoral}
                />
                <StatCard
                  label="Hours Funded"
                  value={`${formatHours(d.milestone_progress_hours)} hrs`}
                  valueStyle={styles.statValueSlate}
                />
              </View>
              <View style={styles.statsRow}>
                <StatCard
                  label="IC Balance"
                  value={`${(Number(d.ic_balance) || 0).toLocaleString()} IC`}
                  valueStyle={styles.statValueGreen}
                />
                <StatCard
                  label="$KINDER"
                  value={
                    d.kinder_balance != null ? String(d.kinder_balance) : '—'
                  }
                  valueStyle={styles.statValueGold}
                />
              </View>
            </View>

            <View style={styles.milestoneCard}>
              <Text style={styles.milestoneText}>
                {`You've funded ${milestoneProgress} of ${milestoneTarget} verified hours`}
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    progressWidthStyles[`progressWidth${pct}`],
                  ]}
                />
              </View>
              <Text style={styles.milestoneFooter}>
                {remaining > 0
                  ? `${remaining} hours to go!`
                  : '🎉 Milestone reached!'}
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Impact Timeline</Text>
              <Text style={styles.sectionSubtitle}>
                Donation → event → verified volunteer hours.
              </Text>

              {receiptsLoading && receipts.length === 0 ? (
                <ActivityIndicator color={theme.coral} />
              ) : null}

              {receiptsError ? (
                <Text style={styles.receiptsErrorText}>{receiptsError}</Text>
              ) : null}

              {receipts.length === 0 && !receiptsLoading ? (
                <Text style={styles.emptyTimelineText}>No receipts yet.</Text>
              ) : null}

              {receipts.map(item => (
                <TimelineCard
                  key={item?.id || item?.donation_id || item?.created_at}
                  item={item}
                />
              ))}
            </View>
          </>
        ) : null}

        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const progressWidthStyles = StyleSheet.create(
  Array.from({length: 101}, (_, i) => i).reduce((acc, pct) => {
    acc[`progressWidth${pct}`] = {
      width: `${pct}%`,
    };
    return acc;
  }, {}),
);

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: theme.slate,
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  avatarText: {
    color: theme.white,
    fontSize: 28,
    fontWeight: '800',
  },
  centered: {
    alignItems: 'center',
    backgroundColor: theme.background,
    flex: 1,
    justifyContent: 'center',
  },
  displayName: {
    color: theme.slate,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  donateButton: {
    backgroundColor: theme.coral,
    borderRadius: 12,
    marginBottom: 4,
    marginTop: 20,
    padding: 16,
  },
  donateButtonText: {
    color: theme.white,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  email: {
    color: '#8d9099',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  emptyBody: {
    color: '#8d9099',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: theme.white,
    borderRadius: 14,
    marginTop: 16,
    padding: 24,
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyHeading: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyTimelineText: {
    color: '#8d9099',
    fontSize: 14,
  },
  errorText: {
    color: '#c8342f',
    fontSize: 14,
  },
  memberSinceText: {
    color: '#8d9099',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  logoutButton: {
    alignItems: 'center',
    borderColor: '#e5e7eb',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    marginTop: 32,
    padding: 14,
  },
  logoutButtonText: {
    color: '#c8342f',
    fontSize: 15,
    fontWeight: '700',
  },
  milestoneCard: {
    backgroundColor: theme.white,
    borderRadius: 14,
    marginBottom: 12,
    marginTop: 4,
    padding: 16,
  },
  milestoneFooter: {
    color: '#1a7f4b',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  milestoneText: {
    color: '#1a7f4b',
    fontSize: 13,
    marginBottom: 8,
  },
  previewCard: {
    alignItems: 'center',
    backgroundColor: '#f7f3ed',
    borderRadius: 12,
    flex: 1,
    marginHorizontal: 4,
    padding: 12,
  },
  previewLabel: {
    color: '#8d9099',
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
  },
  previewNote: {
    color: '#8d9099',
    fontSize: 11,
    marginBottom: 0,
    marginTop: 8,
  },
  previewRow: {
    flexDirection: 'row',
    marginBottom: 8,
    marginHorizontal: -4,
    marginTop: 20,
  },
  previewValue: {
    color: theme.coral,
    fontSize: 16,
    fontWeight: '700',
  },
  profileHeader: {
    alignItems: 'center',
  },
  profileHeaderText: {
    alignItems: 'center',
    marginTop: 12,
  },
  progressFill: {
    backgroundColor: '#2db36f',
    borderRadius: 4,
    height: 8,
  },
  progressTrack: {
    backgroundColor: '#c8f0d8',
    borderRadius: 4,
    height: 8,
    overflow: 'hidden',
  },
  receiptsErrorText: {
    color: '#c8342f',
    fontSize: 14,
    marginBottom: 8,
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
    marginTop: 8,
  },
  sectionSubtitle: {
    color: '#8d9099',
    fontSize: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    color: theme.slate,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  statCard: {
    alignItems: 'center',
    backgroundColor: theme.white,
    borderRadius: 14,
    flex: 1,
    marginBottom: 8,
    marginHorizontal: 4,
    paddingHorizontal: 10,
    paddingVertical: 14,
  },
  statLabel: {
    color: '#8d9099',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  statsGrid: {
    marginTop: 16,
  },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: -4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  statValueCoral: {
    color: theme.coral,
  },
  statValueGold: {
    color: '#f5a623',
  },
  statValueGreen: {
    color: '#2db36f',
  },
  statValueSlate: {
    color: theme.slate,
  },
  tierPill: {
    alignSelf: 'center',
    borderRadius: 999,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  tierPillCasual: {
    backgroundColor: '#6b7f9e',
  },
  tierPillChampion: {
    backgroundColor: theme.coral,
  },
  tierPillImpact: {
    backgroundColor: theme.slate,
  },
  tierPillText: {
    color: theme.white,
    fontSize: 12,
    fontWeight: '700',
  },
  timelineBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  timelineBadgeFunded: {
    backgroundColor: '#eafaf2',
  },
  timelineBadgePending: {
    backgroundColor: '#fff7ec',
  },
  timelineBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  timelineBadgeTextFunded: {
    color: '#1a7f4b',
  },
  timelineBadgeTextPending: {
    color: '#8c5a00',
  },
  timelineCard: {
    backgroundColor: '#f7f3ed',
    borderLeftWidth: 4,
    borderRadius: 10,
    marginBottom: 8,
    padding: 12,
  },
  timelineCardFunded: {
    borderLeftColor: '#2db36f',
  },
  timelineCardPending: {
    borderLeftColor: '#f5a623',
  },
  timelineDetail: {
    color: theme.slate,
    fontSize: 12,
    marginTop: 4,
  },
  timelineMeta: {
    color: '#8d9099',
    fontSize: 12,
    marginTop: 4,
  },
  timelinePendingText: {
    color: '#8c5a00',
    fontSize: 12,
    marginTop: 4,
  },
  timelineTitle: {
    color: theme.text,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    marginRight: 8,
  },
  timelineTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
});
