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
import {fetchEvents} from '../api/events';
import theme from '../constants/theme';

const FILTER_OPTIONS = [
  {label: 'Upcoming', value: 'upcoming'},
  {label: 'Past', value: 'archive'},
];

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

function formatEventMeta(event) {
  const date = event?.start_at
    ? new Date(event.start_at).toLocaleDateString('en-CA', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : '';

  return [date, event?.location_text].filter(Boolean).join(' · ');
}

function EventCard({event, onPress}) {
  const badge = getEventTypeBadge(event?.event_type);
  const metaText = formatEventMeta(event);
  const impactCredits = Number(event?.impact_credits_base) || 0;

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={styles.eventCard}>
      <View style={styles.eventCardHeader}>
        <Text numberOfLines={1} style={styles.eventTitle}>
          {event?.title || 'Untitled Event'}
        </Text>
        {badge ? (
          <View style={[styles.eventTypeBadge, badge.badgeStyle]}>
            <Text style={[styles.eventTypeBadgeText, badge.textStyle]}>
              {badge.label}
            </Text>
          </View>
        ) : null}
      </View>

      {event?.org_name ? (
        <Text numberOfLines={1} style={styles.eventOrg}>
          {event.org_name}
        </Text>
      ) : null}

      {metaText ? (
        <Text numberOfLines={1} style={styles.eventMeta}>
          {metaText}
        </Text>
      ) : null}

      {impactCredits > 0 ? (
        <Text style={styles.eventCredits}>
          🌟 {impactCredits} Impact Credits
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function EventsScreen() {
  const navigation = useNavigation();
  const [view, setView] = useState('upcoming');
  const [events, setEvents] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const loadEvents = useCallback(
    async ({reset = false, cursor = null, mode = 'initial'} = {}) => {
      try {
        if (!API_BASE_URL) {
          throw new Error('API base URL is not configured');
        }

        setError('');
        const json = await fetchEvents({
          view,
          limit: 20,
          cursor,
        });

        const nextPageCursor = json?.paging?.next_cursor ?? null;
        const incomingEvents = Array.isArray(json?.data) ? json.data : [];

        setEvents(currentEvents =>
          reset ? incomingEvents : [...currentEvents, ...incomingEvents],
        );
        setNextCursor(nextPageCursor);
      } catch (err) {
        if (reset) {
          setEvents([]);
          setNextCursor(null);
          setError(err.message || 'Unable to load events');
        }
      } finally {
        if (mode === 'initial') {
          setInitialLoading(false);
        } else if (mode === 'refresh') {
          setRefreshing(false);
        } else if (mode === 'more') {
          setLoadingMore(false);
        }
      }
    },
    [view],
  );

  useEffect(() => {
    setEvents([]);
    setNextCursor(null);
    setInitialLoading(true);
    loadEvents({reset: true, cursor: null, mode: 'initial'});
  }, [loadEvents]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadEvents({reset: true, cursor: null, mode: 'refresh'});
  }, [loadEvents]);

  const onEndReached = useCallback(() => {
    if (!nextCursor || loadingMore || initialLoading || refreshing) {
      return;
    }

    setLoadingMore(true);
    loadEvents({reset: false, cursor: nextCursor, mode: 'more'});
  }, [initialLoading, loadEvents, loadingMore, nextCursor, refreshing]);

  const onSelectView = useCallback(
    nextView => {
      if (nextView === view) {
        return;
      }
      setView(nextView);
    },
    [view],
  );

  const renderItem = useCallback(
    ({item}) => (
      <EventCard
        event={item}
        onPress={() =>
          navigation.navigate('EventDetail', {eventId: item.id})
        }
      />
    ),
    [navigation],
  );

  const keyExtractor = useCallback(
    item => String(item?.id ?? item?.event_id ?? ''),
    [],
  );

  const renderFooter = useCallback(() => {
    if (!loadingMore) {
      return null;
    }

    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator color={theme.coral} />
      </View>
    );
  }, [loadingMore]);

  const renderEmpty = useCallback(() => {
    if (initialLoading) {
      return null;
    }

    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>No events found</Text>
      </View>
    );
  }, [initialLoading]);

  if (initialLoading) {
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
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Volunteer Events</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersContent}
            style={styles.filtersScroll}>
            {FILTER_OPTIONS.map(option => {
              const isActive = option.value === view;
              return (
                <TouchableOpacity
                  key={option.value}
                  activeOpacity={0.9}
                  onPress={() => onSelectView(option.value)}
                  style={[
                    styles.filterPill,
                    isActive ? styles.filterPillActive : styles.filterPillInactive,
                  ]}>
                  <Text
                    style={[
                      styles.filterPillText,
                      isActive
                        ? styles.filterPillTextActive
                        : styles.filterPillTextInactive,
                    ]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <FlatList
          data={events}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={
            events.length > 0 ? styles.listContent : styles.listContentEmpty
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.coral}
            />
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    backgroundColor: theme.background,
    flex: 1,
    justifyContent: 'center',
  },
  container: {
    backgroundColor: theme.background,
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 48,
  },
  emptyText: {
    color: '#8d9099',
    fontSize: 15,
  },
  errorText: {
    color: '#c8342f',
    fontSize: 14,
  },
  eventCard: {
    backgroundColor: theme.white,
    borderRadius: 14,
    marginBottom: 12,
    padding: 14,
    shadowColor: '#000000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  eventCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  eventCredits: {
    color: theme.coral,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
  },
  eventMeta: {
    color: '#8d9099',
    fontSize: 12,
    marginTop: 6,
  },
  eventOrg: {
    color: theme.slate,
    fontSize: 13,
    marginTop: 8,
  },
  eventTitle: {
    color: theme.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    marginRight: 10,
  },
  eventTypeBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
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
  filterPill: {
    borderRadius: 999,
    marginRight: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterPillActive: {
    backgroundColor: '#ff5656',
  },
  filterPillInactive: {
    backgroundColor: theme.white,
  },
  filterPillText: {
    fontSize: 13,
  },
  filterPillTextActive: {
    color: theme.white,
    fontWeight: '700',
  },
  filterPillTextInactive: {
    color: '#455a7c',
    fontWeight: '600',
  },
  filtersContent: {
    paddingRight: 8,
  },
  filtersScroll: {
    marginBottom: 12,
  },
  footerLoader: {
    paddingVertical: 12,
  },
  header: {
    marginBottom: 8,
  },
  headerTitle: {
    color: theme.slate,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
  },
  listContent: {
    paddingBottom: 24,
  },
  listContentEmpty: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  safeArea: {
    backgroundColor: theme.background,
    flex: 1,
  },
});
