import { onIPhone } from './platform';

interface ComposerBridge {
  postMessage(message: {
    action: 'show' | 'hide' | 'focus' | 'blur';
    session?: string;
    draft?: string;
    revision?: number;
    editable?: boolean;
    canSend?: boolean;
    theme?: string;
  }): void;
}

const webkit = (window as Window & {
  webkit?: { messageHandlers?: { chatComposer?: ComposerBridge } };
}).webkit;

export const nativeComposer = onIPhone ? webkit?.messageHandlers?.chatComposer : undefined;
