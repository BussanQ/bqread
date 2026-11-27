import { Capacitor } from '@capacitor/core';

export const onIPhone = Capacitor.getPlatform() === 'ios';
