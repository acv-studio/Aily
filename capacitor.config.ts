import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // Keep this stable after installing: changing the origin/app ID strands local data.
  appId: 'com.aily.app',
  appName: 'Aily',
  webDir: 'dist',
  backgroundColor: '#090b14',
  server: {
    // Ship bundled assets, never a remote/live-reload URL or cleartext transport.
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
  },
}

export default config
