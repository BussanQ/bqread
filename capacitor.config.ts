import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bussanq.bqread',
  appName: '墨读',
  webDir: 'dist',
  ios: { zoomEnabled: false },
  experimental: { ios: { spm: { swiftToolsVersion: '6.0' } } },
  loggingBehavior: 'none',
};

export default config;
