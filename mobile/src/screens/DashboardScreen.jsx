import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import {API_BASE_URL} from '@env';
import {useAuth} from '../context/AuthContext';
import theme from '../constants/theme';

function StatCard({label, value}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ReliabilityRow({score, ratingStarsFilled}) {
  const safeScore = Math.max(0, Math.min(100, Number(score) || 0));
  const safeRatingStars = Math.max(
    1,
    Math.min(5, Number(ratingStarsFilled) || 5),
  );

  const starDisplay = Array.from({length: 5}, (_, i) =>
    i < safeRatingStars ? '★' : '☆'
  ).join('');

  return (
    <View style={styles.reliabilityRow}>
      <Text style={styles.reliabilityLabel}>Reliability: {safeScore}</Text>
      <View style={styles.reliabilityRight}>
        <Text style={styles.reliabilityRatingLabel}>Rating:</Text>
        <Text style={styles.reliabilityStars}>{starDisplay}</Text>
      </View>
    </View>
  );
}

function EventRow({event, isPast}) {
  const date = event.start_at
    ? new Date(event.start_at).toLocaleDateString('en-CA', {
        month: 'short',
        day: 'numeric',
      })
    : '';
  return (
    <View style={styles.eventRow}>
      <View style={styles.eventDate}>
        <Text style={styles.eventDateText}>{date}</Text>
      </View>
      <View style={styles.eventInfo}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {event.title}
        </Text>
        {event.org_name ? (
          <Text style={styles.eventOrg} numberOfLines={1}>
            {event.org_name}
          </Text>
        ) : null}
        {event.location_text ? (
          <Text style={styles.eventLocation} numberOfLines={1}>
            {event.location_text}
          </Text>
        ) : null}
      </View>
      {isPast && event.verification_status ? (
        <View
          style={[
            styles.badge,
            event.verification_status === 'verified'
              ? styles.badgeVerified
              : styles.badgePending,
          ]}>
          <Text style={styles.badgeText}>
            {event.verification_status === 'verified' ? 'Verified' : 'Pending'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function DashboardScreen() {
  const navigation = useNavigation();
  const {token, user} = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const fetchDashboard = useCallback(async () => {
    try {
      setError('');
      const response = await fetch(`${API_BASE_URL}/api/me/dashboard`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'Unable to load dashboard');
      }
      setData(json.data);
    } catch (err) {
      setError(err.message || 'Unable to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={theme.coral} size="large" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

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
        <View style={styles.header}>
          <Text style={styles.greeting}>
            Hi, {user?.name || user?.firstname || 'Volunteer'} 👋
          </Text>
          <Text style={styles.subheading}>Your impact at a glance</Text>
        </View>

        <View style={styles.statsRow}>
          <StatCard
            label="Impact Credits"
            value={data?.impact_credits_balance ?? 0}
          />
          <StatCard
            label="Hours Volunteered"
            value={data?.verified_hours_total ?? 0}
          />
          <StatCard
            label="Shifts Completed"
            value={data?.verified_shifts_total ?? 0}
          />
        </View>

        <View style={styles.tierRow}>
          <Text style={styles.tierLabel}>Priority Tier</Text>
          <Text style={styles.tierValue}>{data?.priority_tier ?? 'Bronze'}</Text>
        </View>

        <ReliabilityRow
          score={data?.reliability_score ?? 0}
          ratingStarsFilled={data?.rating_stars_filled ?? 5}
        />

        {Array.isArray(data?.upcoming) && data.upcoming.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Upcoming Opportunities</Text>
            {data.upcoming.map(event => (
              <TouchableOpacity
                key={event.event_id}
                activeOpacity={0.85}
                onPress={() =>
                  navigation.navigate('Events', {
                    screen: 'EventDetail',
                    params: {eventId: event.event_id},
                  })
                }>
                <EventRow event={event} isPast={false} />
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Upcoming Opportunities</Text>
            <Text style={styles.emptyText}>No upcoming opportunities. Browse events to sign up.</Text>
          </View>
        )}

        {Array.isArray(data?.recent_history) && data.recent_history.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent History</Text>
            {data.recent_history.map(event => (
              <EventRow key={event.event_id} event={event} isPast={true} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgePending: {
    backgroundColor: '#f0e6c8',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  badgeVerified: {
    backgroundColor: '#d4edda',
  },
  centered: {
    alignItems: 'center',
    backgroundColor: theme.background,
    flex: 1,
    justifyContent: 'center',
  },
  emptyText: {
    color: '#8d9099',
    fontSize: 14,
    marginTop: 8,
  },
  errorText: {
    color: '#c8342f',
    fontSize: 14,
  },
  eventDate: {
    alignItems: 'center',
    marginRight: 12,
    width: 40,
  },
  eventDateText: {
    color: theme.coral,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  eventInfo: {
    flex: 1,
  },
  eventLocation: {
    color: '#8d9099',
    fontSize: 12,
    marginTop: 2,
  },
  eventOrg: {
    color: theme.slate,
    fontSize: 12,
    marginTop: 2,
  },
  eventRow: {
    alignItems: 'center',
    backgroundColor: theme.white,
    borderRadius: 12,
    flexDirection: 'row',
    marginBottom: 8,
    padding: 12,
  },
  eventTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  greeting: {
    color: theme.slate,
    fontSize: 22,
    fontWeight: '800',
  },
  header: {
    marginBottom: 20,
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
    paddingBottom: 32,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    color: theme.slate,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  statCard: {
    alignItems: 'center',
    backgroundColor: theme.white,
    borderRadius: 14,
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  statLabel: {
    color: '#8d9099',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: -4,
  },
  statValue: {
    color: theme.coral,
    fontSize: 22,
    fontWeight: '800',
  },
  subheading: {
    color: '#8d9099',
    fontSize: 14,
    marginTop: 4,
  },
  tierLabel: {
    color: theme.slate,
    fontSize: 14,
  },
  tierRow: {
    alignItems: 'center',
    backgroundColor: theme.white,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    padding: 14,
  },
  tierValue: {
    color: theme.coral,
    fontSize: 14,
    fontWeight: '700',
  },
  reliabilityRow: {
    alignItems: 'center',
    backgroundColor: theme.white,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    padding: 14,
  },
  reliabilityLabel: {
    color: theme.slate,
    fontSize: 14,
  },
  reliabilityRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  reliabilityStars: {
    color: theme.coral,
    fontSize: 16,
    letterSpacing: 2,
  },
  reliabilityRatingLabel: {
    color: theme.slate,
    fontSize: 14,
  },
});
