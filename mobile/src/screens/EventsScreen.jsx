import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {API_BASE_URL} from '@env';
import {fetchEvents} from '../api/events';
import theme from '../constants/theme';

const CAUSE_FILTERS = [
  'All',
  'Outdoors',
  'Food & Hunger',
  'Education',
  'Community',
  'Health',
  'Arts & Culture',
  'Sports',
  'Animals',
  'Environment',
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
  const impactCreditsRate = Number(event?.impact_credits_rate || event?.impact_credits_base) || 0;
  const impactCreditsEstimate = Number(event?.impact_credits_estimate) || impactCreditsRate;

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

      {impactCreditsRate > 0 ? (
        <Text style={styles.eventCredits}>
          🌟 {impactCreditsRate} IC/hr · ~{impactCreditsEstimate} IC
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function EventsScreen() {
  const navigation = useNavigation();
  const [view] = useState('upcoming');
  const [activeCause, setActiveCause] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [events, setEvents] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      return () => {
        setSearchText('');
      };
    }, []),
  );

  const filteredEvents = useMemo(() => {
    const trimmed = searchText.trim().toLowerCase();
    if (!trimmed) {
      return events;
    }
    const results = events.filter(event => {
      const fields = [
        event.title,
        event.org_name,
        event.location_text,
        event.description,
        event.community_tag,
      ];
      return fields.some(
        field => typeof field === 'string' && field.toLowerCase().includes(trimmed),
      );
    });
    return results;
  }, [events, searchText]);

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
          cause_tag: activeCause === 'All' ? undefined : activeCause,
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
    [activeCause, view],
  );

  useEffect(() => {
    setEvents([]);
    setNextCursor(null);
    setInitialLoading(true);
    loadEvents({reset: true, cursor: null, mode: 'initial'});
  }, [activeCause, loadEvents]);

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

  useCallback(() => {}, []);

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
        <Text style={styles.emptyText}>
          {searchText.trim().length > 0
            ? 'No events match your search.'
            : 'No events found'}
        </Text>
      </View>
    );
  }, [initialLoading, searchText]);

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
        </View>

        <TextInput
          placeholder="Search events..."
          placeholderTextColor="#8d9099"
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={styles.searchInput}
        />

        <View style={styles.filterScroll}>
          <ScrollView
            horizontal={true}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScrollContent}>
            {CAUSE_FILTERS.map(cause => {
              const isActive = activeCause === cause;
              return (
                <Pressable
                  key={cause}
                  onPress={() => setActiveCause(cause)}
                  style={[
                    styles.filterPill,
                    isActive ? styles.filterPillActive : null,
                  ]}>
                  <Text
                    style={[
                      styles.filterPillText,
                      isActive ? styles.filterPillTextActive : null,
                    ]}>
                    {cause}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <FlatList
          data={filteredEvents}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={
            filteredEvents.length > 0 ? styles.listContent : styles.listContentEmpty
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
  filterPill: {
    backgroundColor: theme.white,
    borderColor: theme.slate,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterPillActive: {
    backgroundColor: theme.coral,
    borderColor: theme.coral,
  },
  filterPillText: {
    color: theme.slate,
    fontSize: 13,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: theme.white,
  },
  filterScroll: {
    marginBottom: 12,
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  filterScrollContent: {
    paddingRight: 8,
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
  searchInput: {
    backgroundColor: theme.white,
    borderColor: '#d7dbe3',
    borderRadius: 12,
    borderWidth: 1,
    color: theme.text,
    fontSize: 15,
    height: 42,
    marginBottom: 10,
    marginHorizontal: -16,
    paddingHorizontal: 14,
  },
});
