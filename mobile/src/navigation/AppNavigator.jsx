import React from 'react';
import {
  DefaultTheme,
  NavigationContainer,
  getFocusedRouteNameFromRoute,
} from '@react-navigation/native';
import {StyleSheet, Text} from 'react-native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import DashboardScreen from '../screens/DashboardScreen';
import EventDetailScreen from '../screens/EventDetailScreen';
import EventsScreen from '../screens/EventsScreen';
import KAIScreen from '../screens/KAIScreen';
import LoginScreen from '../screens/LoginScreen';
import OrgPortalScreen from '../screens/OrgPortalScreen';
import ProfileScreen from '../screens/ProfileScreen';
import theme from '../constants/theme';
import {useAuth} from '../context/AuthContext';

const RootStack = createNativeStackNavigator();
const EventsStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: theme.background,
    border: theme.background,
    card: theme.white,
    notification: theme.coral,
    primary: theme.coral,
    text: theme.text,
  },
};

function TabIcon({label, color, size = 18, elevated = false}) {
  return (
    <Text
      style={[
        styles.tabIcon,
        color === theme.coral ? styles.tabIconCoral : styles.tabIconSlate,
        size > 18 ? styles.tabIconLarge : styles.tabIconDefault,
        elevated ? styles.tabIconElevated : null,
      ]}>
      {label}
    </Text>
  );
}

function DashboardTabIcon({color}) {
  return <TabIcon label="🏠" color={color} />;
}

function EventsTabIcon({color}) {
  return <TabIcon label="📅" color={color} />;
}

function KAITabIcon() {
  return <TabIcon label="✦" color={theme.coral} elevated={true} size={28} />;
}

function KAITabLabel() {
  return <Text style={styles.kaiTabLabel}>KAI</Text>;
}

function OrgPortalTabIcon({color}) {
  return <TabIcon label="🏢" color={color} />;
}

function ProfileTabIcon({color}) {
  return <TabIcon label="👤" color={color} />;
}

function EventsNavigator() {
  return (
    <EventsStack.Navigator
      screenOptions={{
        contentStyle: {backgroundColor: theme.background},
        headerStyle: {backgroundColor: theme.background},
        headerTintColor: theme.slate,
      }}>
      <EventsStack.Screen name="EventsList" component={EventsScreen} />
      <EventsStack.Screen
        name="EventDetail"
        component={EventDetailScreen}
        options={{title: 'Event Detail'}}
      />
    </EventsStack.Navigator>
  );
}

function MainTabs() {
  const {user} = useAuth();

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: {backgroundColor: theme.background},
        headerTintColor: theme.slate,
        sceneStyle: {backgroundColor: theme.background},
        tabBarActiveTintColor: theme.coral,
        tabBarInactiveTintColor: theme.slate,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
          paddingBottom: 4,
        },
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopColor: 'transparent',
          elevation: 0,
          height: 72,
          paddingTop: 8,
        },
      }}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: DashboardTabIcon,
        }}
      />
      <Tab.Screen
        name="Events"
        component={EventsNavigator}
        options={({route}) => {
          const focusedRouteName =
            getFocusedRouteNameFromRoute(route) || 'EventsList';
          const hideTabBar = focusedRouteName === 'EventDetail';

          return {
            headerShown: false,
            tabBarIcon: EventsTabIcon,
            tabBarStyle: hideTabBar
              ? {display: 'none'}
              : {
                  backgroundColor: theme.background,
                  borderTopColor: 'transparent',
                  elevation: 0,
                  height: 72,
                  paddingTop: 8,
                },
          };
        }}
      />
      <Tab.Screen
        name="KAI"
        component={KAIScreen}
        options={{
          tabBarIcon: KAITabIcon,
          tabBarLabel: KAITabLabel,
          tabBarItemStyle: {
            marginTop: -6,
          },
        }}
      />
      {user?.org_rep === true ? (
        <Tab.Screen
          name="Org Portal"
          component={OrgPortalScreen}
          options={{
            tabBarIcon: OrgPortalTabIcon,
          }}
        />
      ) : null}
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ProfileTabIcon,
        }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const {token} = useAuth();
  const isHydrating = typeof token === 'undefined';

  if (isHydrating) {
    return null;
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <RootStack.Navigator
        screenOptions={{
          contentStyle: {backgroundColor: theme.background},
          headerStyle: {backgroundColor: theme.background},
          headerTintColor: theme.slate,
          headerShown: false,
        }}>
        {token ? (
          <RootStack.Screen name="AuthenticatedApp" component={MainTabs} />
        ) : (
          <RootStack.Screen
            name="Login"
            component={LoginScreen}
            options={{headerShown: true, title: 'Login'}}
          />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  kaiTabLabel: {
    color: theme.coral,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
  },
  tabIcon: {
    textAlign: 'center',
  },
  tabIconCoral: {
    color: theme.coral,
  },
  tabIconDefault: {
    fontSize: 18,
  },
  tabIconElevated: {
    marginTop: -8,
  },
  tabIconLarge: {
    fontSize: 28,
  },
  tabIconSlate: {
    color: theme.slate,
  },
});
