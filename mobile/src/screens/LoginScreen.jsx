import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {GoogleSignin, statusCodes} from '@react-native-google-signin/google-signin';
import {API_BASE_URL, IOS_CLIENT_ID} from '@env';
import theme from '../constants/theme';
import {useAuth} from '../context/AuthContext';

export default function LoginScreen() {
  const {login} = useAuth();

  useEffect(() => {
    GoogleSignin.configure({
      iosClientId: IOS_CLIENT_ID,
    });
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  const isSignInDisabled = useMemo(
    () => isSubmitting || isGoogleSubmitting,
    [isGoogleSubmitting, isSubmitting],
  );

  async function handleEmailLogin() {
    const normalizedEmail = email.trim();
    const normalizedPassword = password.trim();

    if (!normalizedEmail || !normalizedPassword) {
      setError('Email and password are required.');
      return;
    }

    try {
      setError('');
      setIsSubmitting(true);
      await login(normalizedEmail, normalizedPassword);
    } catch (loginError) {
      setError(loginError?.message || 'Unable to sign in right now.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    try {
      setError('');
      setIsGoogleSubmitting(true);
      await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog: true});
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.data?.idToken;
      if (!idToken) {
        throw new Error('No ID token returned from Google.');
      }
      const response = await fetch(`${API_BASE_URL}/api/auth/mobile-google`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({idToken}),
      });
      const data = await response.json();
      if (!response.ok || !data.token) {
        throw new Error(data.error || 'Google sign-in failed.');
      }
      await login(null, null, data.token, data.user);
    } catch (googleError) {
      if (googleError.code === statusCodes.SIGN_IN_CANCELLED) {
        // user cancelled, do nothing
      } else {
        setError(googleError?.message || 'Google sign-in failed.');
      }
    } finally {
      setIsGoogleSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
        style={styles.container}>
        <View style={styles.heroSection}>
          <Image
            source={require('../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.tagline}>The world gets kinder when you do</Text>
        </View>

        <View style={styles.cardSection}>
          <Text style={styles.heading}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor="#8d9099"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
          />

          <TextInput
            placeholder="Password"
            placeholderTextColor="#8d9099"
            secureTextEntry={true}
            style={styles.input}
            value={password}
            onChangeText={setPassword}
          />

          <Pressable
            disabled={isSignInDisabled}
            onPress={handleEmailLogin}
            style={({pressed}) => [
              styles.signInButton,
              isSignInDisabled ? styles.buttonDisabled : null,
              pressed && !isSignInDisabled ? styles.buttonPressed : null,
            ]}>
            {isSubmitting ? (
              <ActivityIndicator color={theme.white} />
            ) : (
              <Text style={styles.signInButtonLabel}>Sign In</Text>
            )}
          </Pressable>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            disabled={isSignInDisabled}
            onPress={handleGoogleLogin}
            style={({pressed}) => [
              styles.googleButton,
              isSignInDisabled ? styles.googleButtonDisabled : null,
              pressed && !isSignInDisabled ? styles.buttonPressed : null,
            ]}>
            {isGoogleSubmitting ? (
              <ActivityIndicator color={theme.slate} />
            ) : (
              <>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={styles.googleButtonLabel}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => Linking.openURL('https://getkinder.ai/register').catch(() => {})}
            style={styles.signUpLink}>
            <Text style={styles.signUpText}>
              Don't have an account? Sign up
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonPressed: {
    opacity: 0.9,
  },
  cardSection: {
    backgroundColor: theme.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
  },
  container: {
    backgroundColor: theme.background,
    flex: 1,
  },
  dividerLine: {
    backgroundColor: '#d6d6d6',
    flex: 1,
    height: 1,
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 22,
    marginBottom: 20,
  },
  dividerText: {
    color: '#8d9099',
    fontSize: 14,
    marginHorizontal: 12,
  },
  errorText: {
    color: '#c8342f',
    fontSize: 13,
    marginTop: 10,
  },
  googleButton: {
    alignItems: 'center',
    borderColor: theme.slate,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    height: 52,
    justifyContent: 'center',
  },
  googleButtonDisabled: {
    backgroundColor: '#f2f3f5',
  },
  googleButtonLabel: {
    color: theme.slate,
    fontSize: 16,
    fontWeight: '600',
  },
  googleIcon: {
    color: theme.slate,
    fontSize: 18,
    fontWeight: '800',
    marginRight: 10,
  },
  heading: {
    color: theme.slate,
    fontSize: 32,
    fontWeight: '800',
  },
  heroSection: {
    alignItems: 'center',
    backgroundColor: theme.white,
    justifyContent: 'center',
    minHeight: '35%',
    paddingHorizontal: 24,
  },
  input: {
    borderColor: '#d7dbe3',
    borderRadius: 14,
    borderWidth: 1,
    color: theme.text,
    fontSize: 16,
    height: 48,
    marginTop: 14,
    paddingHorizontal: 14,
  },
  logo: {
    width: '90%',
    height: 120,
    marginBottom: 8,
  },
  safeArea: {
    backgroundColor: theme.coral,
    flex: 1,
  },
  signInButton: {
    alignItems: 'center',
    backgroundColor: theme.coral,
    borderRadius: 16,
    height: 52,
    justifyContent: 'center',
    marginTop: 18,
  },
  signInButtonLabel: {
    color: theme.white,
    fontSize: 16,
    fontWeight: '700',
  },
  signUpLink: {
    alignItems: 'center',
    marginTop: 'auto',
    paddingTop: 24,
  },
  signUpText: {
    color: theme.slate,
    fontSize: 14,
    textAlign: 'center',
  },
  subtitle: {
    color: '#8d9099',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 8,
  },
  tagline: {
    color: theme.white,
    fontSize: 16,
    fontStyle: 'italic',
    marginTop: 4,
    textAlign: 'center',
  },
});
