/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import {AuthProvider} from './src/context/AuthContext';

function Root() {
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}

AppRegistry.registerComponent(appName, () => Root);
