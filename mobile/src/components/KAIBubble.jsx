import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import theme from '../constants/theme';

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return '';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function KAIBubble({message}) {
  const isUser = message?.role === 'user';

  return (
    <View
      style={[
        styles.row,
        isUser ? styles.userRow : styles.assistantRow,
      ]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.assistantBubble,
        ]}>
        <Text
          style={[
            styles.messageText,
            isUser ? styles.userText : styles.assistantText,
          ]}>
          {message?.text || ''}
        </Text>
      </View>
      <Text
        style={[
          styles.timestamp,
          isUser ? styles.userTimestamp : styles.assistantTimestamp,
        ]}>
        {formatTimestamp(message?.timestamp)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: theme.white,
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  assistantRow: {
    alignItems: 'flex-start',
  },
  assistantText: {
    color: theme.slate,
  },
  assistantTimestamp: {
    textAlign: 'left',
  },
  bubble: {
    borderRadius: 22,
    maxWidth: '82%',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  row: {
    marginBottom: 16,
    width: '100%',
  },
  timestamp: {
    color: '#7f8794',
    fontSize: 11,
    marginTop: 6,
    paddingHorizontal: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: theme.coral,
  },
  userRow: {
    alignItems: 'flex-end',
  },
  userText: {
    color: theme.white,
  },
  userTimestamp: {
    textAlign: 'right',
  },
});
