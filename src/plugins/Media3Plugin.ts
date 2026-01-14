import { registerPlugin } from '@capacitor/core';

export interface Media3Config {
  /** Video URL (HLS/DASH/MP4) */
  url: string;
  /** Optional DRM license URL */
  drmLicenseUrl?: string;
  /** DRM scheme (widevine, playready, clearkey) */
  drmScheme?: 'widevine' | 'playready' | 'clearkey';
  /** Start position in seconds */
  startPosition?: number;
  /** Enable adaptive bitrate */
  enableABR?: boolean;
  /** Maximum allowed resolution height */
  maxHeight?: number;
  /** Maximum bitrate in bits per second */
  maxBitrate?: number;
  /** Minimum buffer before playback starts (seconds) */
  minBufferMs?: number;
  /** Target buffer size (seconds) */
  maxBufferMs?: number;
  /** Buffer after rebuffer (seconds) */
  bufferForPlaybackAfterRebufferMs?: number;
  /** Custom headers for network requests */
  headers?: Record<string, string>;
}

export interface PlaybackState {
  isPlaying: boolean;
  isBuffering: boolean;
  currentPosition: number;
  duration: number;
  bufferedPosition: number;
  playbackSpeed: number;
}

export interface QualityTrack {
  id: string;
  width: number;
  height: number;
  bitrate: number;
  label: string;
}

export interface AudioTrack {
  id: string;
  language: string;
  label: string;
  isSelected: boolean;
}

export interface SubtitleTrack {
  id: string;
  language: string;
  label: string;
  isSelected: boolean;
}

export interface NetworkInfo {
  estimatedBandwidth: number;
  connectionType: 'wifi' | 'cellular' | 'ethernet' | 'unknown';
}

export interface Media3Error {
  code: number;
  message: string;
  isRecoverable: boolean;
}

export interface Media3Plugin {
  /** Initialize the player with configuration */
  initialize(options: Media3Config): Promise<{ success: boolean }>;

  /** Start or resume playback */
  play(): Promise<void>;

  /** Pause playback */
  pause(): Promise<void>;

  /** Stop and release player resources */
  stop(): Promise<void>;

  /** Seek to position in seconds */
  seekTo(options: { position: number }): Promise<void>;

  /** Set playback speed (0.5 - 2.0) */
  setPlaybackSpeed(options: { speed: number }): Promise<void>;

  /** Get current playback state */
  getPlaybackState(): Promise<PlaybackState>;

  /** Get available quality tracks */
  getQualityTracks(): Promise<{ tracks: QualityTrack[] }>;

  /** Set specific quality track (pass null/empty for auto) */
  setQualityTrack(options: { trackId: string | null }): Promise<void>;

  /** Enable/disable adaptive bitrate */
  setABREnabled(options: { enabled: boolean }): Promise<void>;

  /** Get available audio tracks */
  getAudioTracks(): Promise<{ tracks: AudioTrack[] }>;

  /** Select audio track by ID */
  selectAudioTrack(options: { trackId: string }): Promise<void>;

  /** Get available subtitle tracks */
  getSubtitleTracks(): Promise<{ tracks: SubtitleTrack[] }>;

  /** Select subtitle track (null to disable) */
  selectSubtitleTrack(options: { trackId: string | null }): Promise<void>;

  /** Get current network info */
  getNetworkInfo(): Promise<NetworkInfo>;

  /** Set maximum resolution for ABR */
  setMaxResolution(options: { maxHeight: number }): Promise<void>;

  /** Enter fullscreen mode (native player UI) */
  enterFullscreen(): Promise<void>;

  /** Exit fullscreen mode */
  exitFullscreen(): Promise<void>;

  /** Add listener for playback state changes */
  addListener(
    eventName: 'playbackStateChanged',
    listenerFunc: (state: PlaybackState) => void
  ): Promise<{ remove: () => void }>;

  /** Add listener for quality changes */
  addListener(
    eventName: 'qualityChanged',
    listenerFunc: (track: QualityTrack) => void
  ): Promise<{ remove: () => void }>;

  /** Add listener for buffering state */
  addListener(
    eventName: 'bufferingChanged',
    listenerFunc: (data: { isBuffering: boolean }) => void
  ): Promise<{ remove: () => void }>;

  /** Add listener for errors */
  addListener(
    eventName: 'error',
    listenerFunc: (error: Media3Error) => void
  ): Promise<{ remove: () => void }>;

  /** Add listener for network changes */
  addListener(
    eventName: 'networkChanged',
    listenerFunc: (info: NetworkInfo) => void
  ): Promise<{ remove: () => void }>;

  /** Add listener for video end */
  addListener(
    eventName: 'playbackEnded',
    listenerFunc: () => void
  ): Promise<{ remove: () => void }>;

  /** Remove all listeners */
  removeAllListeners(): Promise<void>;
}

/**
 * Media3Plugin - AndroidX Media3 (ExoPlayer) Capacitor Plugin
 * 
 * This plugin provides native Android video playback using AndroidX Media3
 * with full support for:
 * - Adaptive Bitrate (ABR) streaming
 * - HLS and DASH protocols
 * - DRM (Widevine, PlayReady, ClearKey)
 * - Quality selection UI
 * - Network-aware streaming
 * 
 * For iOS and Web, the app falls back to Shaka Player.
 */
export const Media3 = registerPlugin<Media3Plugin>('Media3', {
  web: () => import('./Media3Web').then(m => new m.Media3Web()),
});

// Helper to check if Media3 is available (Android native only)
export function isMedia3Available(): boolean {
  try {
    const { Capacitor } = require('@capacitor/core');
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

// Network strategy presets for different conditions
export const NetworkStrategies = {
  /** WiFi - aggressive buffering, high quality */
  WIFI: {
    minBufferMs: 15000,
    maxBufferMs: 50000,
    bufferForPlaybackAfterRebufferMs: 5000,
    maxBitrate: 20000000, // 20 Mbps
    maxHeight: 1080,
  },
  /** Cellular 4G/5G - balanced */
  CELLULAR_FAST: {
    minBufferMs: 10000,
    maxBufferMs: 30000,
    bufferForPlaybackAfterRebufferMs: 3000,
    maxBitrate: 8000000, // 8 Mbps
    maxHeight: 720,
  },
  /** Cellular 3G - conservative */
  CELLULAR_SLOW: {
    minBufferMs: 5000,
    maxBufferMs: 20000,
    bufferForPlaybackAfterRebufferMs: 2000,
    maxBitrate: 2000000, // 2 Mbps
    maxHeight: 480,
  },
  /** Offline/Unknown - minimal */
  LOW_BANDWIDTH: {
    minBufferMs: 3000,
    maxBufferMs: 15000,
    bufferForPlaybackAfterRebufferMs: 1500,
    maxBitrate: 800000, // 800 Kbps
    maxHeight: 360,
  },
};

// Helper to select network strategy based on connection
export async function getNetworkStrategy(): Promise<typeof NetworkStrategies.WIFI> {
  try {
    const connection = (navigator as any).connection || 
                       (navigator as any).mozConnection || 
                       (navigator as any).webkitConnection;
    
    if (!connection) {
      return NetworkStrategies.CELLULAR_FAST; // Default
    }

    const effectiveType = connection.effectiveType;
    const type = connection.type;

    // WiFi or Ethernet
    if (type === 'wifi' || type === 'ethernet') {
      return NetworkStrategies.WIFI;
    }

    // Cellular based on effective type
    switch (effectiveType) {
      case '4g':
        return NetworkStrategies.CELLULAR_FAST;
      case '3g':
        return NetworkStrategies.CELLULAR_SLOW;
      case '2g':
      case 'slow-2g':
        return NetworkStrategies.LOW_BANDWIDTH;
      default:
        return NetworkStrategies.CELLULAR_FAST;
    }
  } catch {
    return NetworkStrategies.CELLULAR_FAST;
  }
}
