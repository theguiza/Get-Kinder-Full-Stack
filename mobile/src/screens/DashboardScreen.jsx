import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import theme from '../constants/theme';

export default function DashboardScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Dashboard Screen</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: theme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  label: {
    color: theme.text,
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
  },
});
