import React from 'react';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
// @ts-ignore
import AppNavigator from './src/navigation/AppNavigator';
// @ts-ignore
import theme from './src/constants/theme';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <AppNavigator />
    </SafeAreaProvider>
  );
}

export default App;
