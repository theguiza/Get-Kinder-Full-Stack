import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {API_BASE_URL} from '@env';
import KAIInput from '../components/KAIInput';
import KAIBubble from '../components/KAIBubble';
import {getToken} from '../api/auth';
import theme from '../constants/theme';
import {useAuth} from '../context/AuthContext';
const STARTER_CHIPS = [
  'Find volunteer events near me',
  'How does Get Kinder work?',
  'What is an Impact Credit?',
  'Help me find a cause I care about',
];

function createMessage(role, text) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    text,
    timestamp: new Date().toISOString(),
  };
}

function normalizeErrorText(errorPayload) {
  if (!errorPayload) {
    return 'KAI is having trouble right now. Please try again in a moment.';
  }

  if (typeof errorPayload === 'string' && errorPayload.trim()) {
    return errorPayload.trim();
  }

  if (typeof errorPayload?.error === 'string' && errorPayload.error.trim()) {
    return errorPayload.error.trim();
  }

  if (typeof errorPayload?.message === 'string' && errorPayload.message.trim()) {
    return errorPayload.message.trim();
  }

  return 'KAI is having trouble right now. Please try again in a moment.';
}

function TypingIndicator({visible}) {
  const dotOne = useRef(new Animated.Value(0.35)).current;
  const dotTwo = useRef(new Animated.Value(0.35)).current;
  const dotThree = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    if (!visible) {
      dotOne.setValue(0.35);
      dotTwo.setValue(0.35);
      dotThree.setValue(0.35);
      return undefined;
    }

    const createLoop = (animatedValue, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(animatedValue, {
            duration: 280,
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(animatedValue, {
            duration: 280,
            toValue: 0.35,
            useNativeDriver: true,
          }),
        ]),
      );

    const animations = [
      createLoop(dotOne, 0),
      createLoop(dotTwo, 120),
      createLoop(dotThree, 240),
    ];

    animations.forEach(animation => animation.start());

    return () => {
      animations.forEach(animation => animation.stop());
    };
  }, [dotOne, dotTwo, dotThree, visible]);

  if (!visible) {
    return <View style={styles.typingSpacer} />;
  }

  return (
    <View style={styles.typingWrap}>
      <View style={styles.typingBubble}>
        <Animated.View style={[styles.typingDot, {opacity: dotOne}]} />
        <Animated.View style={[styles.typingDot, {opacity: dotTwo}]} />
        <Animated.View style={[styles.typingDot, {opacity: dotThree}]} />
      </View>
    </View>
  );
}

export default function KAIScreen() {
  const {token, user} = useAuth();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const flatListRef = useRef(null);

  const isAuthenticated = useMemo(() => Boolean(user && token), [token, user]);
  const trimmedInput = inputText.trim();
  const sendDisabled = trimmedInput.length === 0 || isLoading;

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({animated});
    });
  }, []);

  useEffect(() => {
    if (messages.length > 0 || isLoading) {
      scrollToBottom();
    }
  }, [isLoading, messages, scrollToBottom]);

  const handleSend = useCallback(
    async presetText => {
      const outgoingText = String(presetText ?? inputText).trim();
      if (!outgoingText || isLoading) {
        return;
      }

      const nextUserMessage = createMessage('user', outgoingText);
      setMessages(currentMessages => [...currentMessages, nextUserMessage]);
      setInputText('');
      setIsLoading(true);

      try {
        let endpoint = `${API_BASE_URL}/api/kai/guest`;
        let headers = {
          'Content-Type': 'application/json',
        };
        let body = {
          message: outgoingText,
        };

        if (isAuthenticated) {
          const bearerToken = token || (await getToken());
          if (bearerToken) {
            endpoint = `${API_BASE_URL}/api/kai/message`;
            headers = {
              ...headers,
              Authorization: `Bearer ${bearerToken}`,
            };
            body = {
              message: outgoingText,
              conversationId,
            };
          }
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok || data?.success === false) {
          throw new Error(normalizeErrorText(data));
        }

        if (data?.conversationId) {
          setConversationId(data.conversationId);
        }

        const assistantText = normalizeErrorText(data?.message);
        setMessages(currentMessages => [
          ...currentMessages,
          createMessage('assistant', assistantText),
          ...(Array.isArray(data?.structuredEvents?.events)
            ? [
                createMessage(
                  'assistant',
                  `I found ${data.structuredEvents.events.length} events — tap Events tab to explore them.`,
                ),
              ]
            : []),
        ]);
      } catch (error) {
        setMessages(currentMessages => [
          ...currentMessages,
          createMessage(
            'assistant',
            normalizeErrorText(error?.message || error),
          ),
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId, inputText, isAuthenticated, isLoading, token],
  );

  const renderMessage = useCallback(({item}) => <KAIBubble message={item} />, []);

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
        style={styles.keyboardAvoidingView}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>KAI</Text>
            <Text style={styles.subtitle}>Kind AI Assistant</Text>
          </View>
        </View>

        {messages.length === 0 ? (
          <ScrollView
            contentContainerStyle={styles.welcomeScrollContent}
            showsVerticalScrollIndicator={false}
            style={styles.welcomeScroll}>
            <View style={styles.avatarRing}>
              <Image
                source={require('../assets/kai-real.png')}
                style={styles.avatar}
              />
            </View>

            <Text style={styles.greetingText}>
              Hey {user?.name || user?.firstname || 'there'}!
            </Text>
            <Text style={styles.greetingSubtext}>
              I'm KAI, your Kind AI Assistant
            </Text>

            <View style={styles.cardGrid}>
              <View style={styles.cardRow}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => handleSend('Find volunteer events near me')}
                  style={styles.actionCard}>
                  <Text style={styles.cardIcon}>🔍</Text>
                  <Text style={styles.cardTitle}>Find events</Text>
                  <Text style={styles.cardSubtitle}>
                    Volunteer opportunities near you
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => handleSend('Show me my impact stats')}
                  style={styles.actionCard}>
                  <Text style={styles.cardIcon}>⭐</Text>
                  <Text style={styles.cardTitle}>My impact</Text>
                  <Text style={styles.cardSubtitle}>
                    Hours, credits & milestones
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.cardRow}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => handleSend('Help me find a cause I care about')}
                  style={styles.actionCard}>
                  <Text style={styles.cardIcon}>💬</Text>
                  <Text style={styles.cardTitle}>Get advice</Text>
                  <Text style={styles.cardSubtitle}>
                    Roles, orgs, or scheduling help
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => handleSend('How does Get Kinder work?')}
                  style={styles.actionCard}>
                  <Text style={styles.cardIcon}>🚀</Text>
                  <Text style={styles.cardTitle}>How it works</Text>
                  <Text style={styles.cardSubtitle}>
                    Get Kinder & Impact Credits
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        ) : null}

        <FlatList
          ref={flatListRef}
          contentContainerStyle={styles.messagesContent}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          showsVerticalScrollIndicator={false}
          style={styles.messagesList}
          onContentSizeChange={() => scrollToBottom(false)}
        />

        <TypingIndicator visible={isLoading} />

        <KAIInput
          disabled={sendDisabled}
          inputText={inputText}
          onChangeText={setInputText}
          onSend={() => handleSend()}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actionCard: {
    backgroundColor: theme.white,
    borderRadius: 14,
    flex: 1,
    marginBottom: 12,
    marginHorizontal: 6,
    padding: 16,
  },
  avatar: {
    borderRadius: 50,
    height: 100,
    width: 100,
  },
  avatarRing: {
    borderColor: theme.coral,
    borderRadius: 56,
    borderWidth: 3,
    padding: 3,
  },
  cardGrid: {
    alignSelf: 'stretch',
    marginTop: 24,
  },
  cardIcon: {
    fontSize: 24,
  },
  cardRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    marginHorizontal: -6,
  },
  cardSubtitle: {
    color: '#8d9099',
    fontSize: 12,
    marginTop: 4,
  },
  cardTitle: {
    color: theme.slate,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
  },
  chip: {
    backgroundColor: theme.background,
    borderColor: theme.slate,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chipLabel: {
    color: theme.slate,
    fontSize: 14,
    fontWeight: '500',
  },
  chipsContent: {
    paddingHorizontal: 16,
  },
  chipsScroll: {
    flexGrow: 0,
    marginBottom: 8,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  greetingSubtext: {
    color: '#8d9099',
    fontSize: 15,
    marginTop: 4,
  },
  greetingText: {
    color: theme.slate,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 14,
  },
  keyboardAvoidingView: {
    backgroundColor: theme.background,
    flex: 1,
  },
  messagesContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  messagesList: {
    flex: 1,
  },
  safeArea: {
    backgroundColor: theme.background,
    flex: 1,
  },
  subtitle: {
    color: theme.slate,
    fontSize: 15,
    marginTop: 2,
  },
  title: {
    color: theme.coral,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  typingBubble: {
    alignItems: 'center',
    backgroundColor: theme.white,
    borderRadius: 18,
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  typingDot: {
    backgroundColor: theme.slate,
    borderRadius: 4,
    height: 8,
    marginHorizontal: 3,
    width: 8,
  },
  typingSpacer: {
    minHeight: 26,
  },
  typingWrap: {
    alignItems: 'flex-start',
    minHeight: 42,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  welcomeScroll: {
    flexGrow: 0,
    marginBottom: 8,
  },
  welcomeScrollContent: {
    alignItems: 'center',
    flexGrow: 1,
    paddingBottom: 20,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
});
