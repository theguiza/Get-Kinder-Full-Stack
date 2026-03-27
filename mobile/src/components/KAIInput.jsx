import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import theme from '../constants/theme';

export default function KAIInput({
  inputText,
  onChangeText,
  onSend,
  disabled,
}) {
  return (
    <View style={styles.container}>
      <View style={styles.inputShell}>
        <TextInput
          multiline={true}
          maxLength={2000}
          numberOfLines={4}
          placeholder="Ask KAI anything..."
          placeholderTextColor="#7f8794"
          style={styles.input}
          textAlignVertical="top"
          value={inputText}
          onChangeText={onChangeText}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onSend}
        style={({pressed}) => [
          styles.sendButton,
          disabled ? styles.sendButtonDisabled : null,
          pressed && !disabled ? styles.sendButtonPressed : null,
        ]}>
        <Text style={styles.sendIcon}>▶</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-end',
    backgroundColor: theme.background,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  input: {
    color: theme.text,
    fontSize: 16,
    lineHeight: 21,
    maxHeight: 96,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  inputShell: {
    backgroundColor: theme.white,
    borderColor: '#d7d0c7',
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    minHeight: 48,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: theme.coral,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  sendButtonDisabled: {
    backgroundColor: '#c4c6cb',
  },
  sendButtonPressed: {
    opacity: 0.85,
  },
  sendIcon: {
    color: theme.white,
    fontSize: 18,
    marginLeft: 2,
  },
});
