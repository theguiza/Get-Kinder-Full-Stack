import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import theme from '../constants/theme';

export default function EventCard() {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>EventCard</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: theme.white,
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 120,
    padding: 16,
  },
  label: {
    color: theme.slate,
    fontSize: 18,
    fontWeight: '600',
  },
});
