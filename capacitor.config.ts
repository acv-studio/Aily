/// <reference types="@capacitor/local-notifications" />
import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize } from '@capacitor/keyboard'

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
    contentInset: 'never',
    preferredContentMode: 'mobile',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_aily_reminder',
      iconColor: '#7b5f96',
      presentationOptions: ['banner', 'list', 'sound'],
    },
    Keyboard: {
      // ChatPanel already tracks visualViewport; avoid a second native resize.
      resize: KeyboardResize.None,
      autoBackdropColor: 'dom',
    },
  },
}

export default config
