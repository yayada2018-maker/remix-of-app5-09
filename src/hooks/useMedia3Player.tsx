import { useRef, useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { 
  Media3, 
  isMedia3Available, 
  getNetworkStrategy,
  type Media3Config,
  type PlaybackState,
  type QualityTrack,
  type AudioTrack,
  type SubtitleTrack,
  type NetworkInfo,
  type Media3Error,
} from '@/plugins/Media3Plugin';

interface UseMedia3PlayerOptions {
  /** Callback when playback state changes */
  onPlaybackStateChange?: (state: PlaybackState) => void;
  /** Callback when quality changes */
  onQualityChange?: (track: QualityTrack) => void;
  /** Callback when buffering state changes */
  onBufferingChange?: (isBuffering: boolean) => void;
  /** Callback when error occurs */
  onError?: (error: Media3Error) => void;
  /** Callback when video ends */
  onEnded?: () => void;
  /** Enable auto quality based on network */
  enableAutoQuality?: boolean;
  /** Custom DRM license URL */
  drmLicenseUrl?: string;
  /** DRM scheme */
  drmScheme?: 'widevine' | 'playready' | 'clearkey';
}

interface UseMedia3PlayerReturn {
  /** Whether Media3 is available (Android native only) */
  isAvailable: boolean;
  /** Whether player is initialized */
  isInitialized: boolean;
  /** Whether player is currently loading */
  isLoading: boolean;
  /** Current playback state */
  playbackState: PlaybackState | null;
  /** Available quality tracks */
  qualityTracks: QualityTrack[];
  /** Current selected quality */
  currentQuality: QualityTrack | null;
  /** Available audio tracks */
  audioTracks: AudioTrack[];
  /** Available subtitle tracks */
  subtitleTracks: SubtitleTrack[];
  /** Current network info */
  networkInfo: NetworkInfo | null;
  /** Initialize player with URL */
  initialize: (url: string, startPosition?: number) => Promise<boolean>;
  /** Play video */
  play: () => Promise<void>;
  /** Pause video */
  pause: () => Promise<void>;
  /** Stop and release player */
  stop: () => Promise<void>;
  /** Seek to position in seconds */
  seekTo: (position: number) => Promise<void>;
  /** Set playback speed */
  setPlaybackSpeed: (speed: number) => Promise<void>;
  /** Set quality track (null for auto) */
  setQuality: (trackId: string | null) => Promise<void>;
  /** Enable/disable ABR */
  setABREnabled: (enabled: boolean) => Promise<void>;
  /** Select audio track */
  selectAudioTrack: (trackId: string) => Promise<void>;
  /** Select subtitle track (null to disable) */
  selectSubtitleTrack: (trackId: string | null) => Promise<void>;
  /** Set max resolution for ABR */
  setMaxResolution: (maxHeight: number) => Promise<void>;
  /** Enter native fullscreen */
  enterFullscreen: () => Promise<void>;
  /** Exit native fullscreen */
  exitFullscreen: () => Promise<void>;
  /** Cleanup all resources */
  cleanup: () => Promise<void>;
}

/**
 * React hook for AndroidX Media3 player on Android native apps
 * Falls back gracefully when not on Android
 */
export function useMedia3Player(options: UseMedia3PlayerOptions = {}): UseMedia3PlayerReturn {
  const {
    onPlaybackStateChange,
    onQualityChange,
    onBufferingChange,
    onError,
    onEnded,
    enableAutoQuality = true,
    drmLicenseUrl,
    drmScheme,
  } = options;

  const [isAvailable] = useState(() => isMedia3Available());
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [playbackState, setPlaybackState] = useState<PlaybackState | null>(null);
  const [qualityTracks, setQualityTracks] = useState<QualityTrack[]>([]);
  const [currentQuality, setCurrentQuality] = useState<QualityTrack | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);

  const listenersRef = useRef<Array<{ remove: () => void }>>([]);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Setup event listeners
  useEffect(() => {
    if (!isAvailable) return;

    const setupListeners = async () => {
      try {
        // Playback state changes
        const playbackListener = await Media3.addListener('playbackStateChanged', (state) => {
          setPlaybackState(state);
          onPlaybackStateChange?.(state);
        });
        listenersRef.current.push(playbackListener);

        // Quality changes
        const qualityListener = await Media3.addListener('qualityChanged', (track) => {
          setCurrentQuality(track);
          onQualityChange?.(track);
        });
        listenersRef.current.push(qualityListener);

        // Buffering changes
        const bufferingListener = await Media3.addListener('bufferingChanged', ({ isBuffering }) => {
          setIsLoading(isBuffering);
          onBufferingChange?.(isBuffering);
        });
        listenersRef.current.push(bufferingListener);

        // Errors
        const errorListener = await Media3.addListener('error', (error) => {
          console.error('[Media3] Error:', error.code, error.message);
          onError?.(error);
          
          // Attempt recovery for recoverable errors
          if (error.isRecoverable) {
            console.log('[Media3] Attempting recovery...');
            // The native side handles recovery
          }
        });
        listenersRef.current.push(errorListener);

        // Network changes
        const networkListener = await Media3.addListener('networkChanged', (info) => {
          setNetworkInfo(info);
        });
        listenersRef.current.push(networkListener);

        // Playback ended
        const endedListener = await Media3.addListener('playbackEnded', () => {
          onEnded?.();
        });
        listenersRef.current.push(endedListener);

      } catch (error) {
        console.error('[Media3] Failed to setup listeners:', error);
      }
    };

    setupListeners();

    return () => {
      listenersRef.current.forEach(listener => listener.remove());
      listenersRef.current = [];
    };
  }, [isAvailable, onPlaybackStateChange, onQualityChange, onBufferingChange, onError, onEnded]);

  // Initialize player
  const initialize = useCallback(async (url: string, startPosition = 0): Promise<boolean> => {
    if (!isAvailable) {
      console.warn('[Media3] Not available - use Shaka Player fallback');
      return false;
    }

    setIsLoading(true);
    setIsInitialized(false);

    try {
      // Get network-appropriate settings
      const networkStrategy = await getNetworkStrategy();
      
      const config: Media3Config = {
        url,
        startPosition,
        enableABR: enableAutoQuality,
        maxHeight: networkStrategy.maxHeight,
        maxBitrate: networkStrategy.maxBitrate,
        minBufferMs: networkStrategy.minBufferMs,
        maxBufferMs: networkStrategy.maxBufferMs,
        bufferForPlaybackAfterRebufferMs: networkStrategy.bufferForPlaybackAfterRebufferMs,
        ...(drmLicenseUrl && { drmLicenseUrl, drmScheme }),
      };

      console.log('[Media3] Initializing with config:', config);
      const result = await Media3.initialize(config);

      if (result.success) {
        setIsInitialized(true);
        
        // Load available tracks
        const [qualityResult, audioResult, subtitleResult, networkResult] = await Promise.all([
          Media3.getQualityTracks(),
          Media3.getAudioTracks(),
          Media3.getSubtitleTracks(),
          Media3.getNetworkInfo(),
        ]);
        
        setQualityTracks(qualityResult.tracks);
        setAudioTracks(audioResult.tracks);
        setSubtitleTracks(subtitleResult.tracks);
        setNetworkInfo(networkResult);

        // Start polling for playback state
        pollingIntervalRef.current = setInterval(async () => {
          try {
            const state = await Media3.getPlaybackState();
            setPlaybackState(state);
          } catch (e) {
            // Ignore polling errors
          }
        }, 250);

        console.log('[Media3] Initialized successfully');
        setIsLoading(false);
        return true;
      }

      console.error('[Media3] Initialization failed');
      setIsLoading(false);
      return false;
    } catch (error) {
      console.error('[Media3] Initialization error:', error);
      setIsLoading(false);
      return false;
    }
  }, [isAvailable, enableAutoQuality, drmLicenseUrl, drmScheme]);

  // Play
  const play = useCallback(async () => {
    if (!isInitialized || !isAvailable) return;
    try {
      await Media3.play();
    } catch (error) {
      console.error('[Media3] Play error:', error);
    }
  }, [isInitialized, isAvailable]);

  // Pause
  const pause = useCallback(async () => {
    if (!isInitialized || !isAvailable) return;
    try {
      await Media3.pause();
    } catch (error) {
      console.error('[Media3] Pause error:', error);
    }
  }, [isInitialized, isAvailable]);

  // Stop
  const stop = useCallback(async () => {
    if (!isAvailable) return;
    try {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      await Media3.stop();
      setIsInitialized(false);
      setPlaybackState(null);
      setQualityTracks([]);
      setCurrentQuality(null);
      setAudioTracks([]);
      setSubtitleTracks([]);
    } catch (error) {
      console.error('[Media3] Stop error:', error);
    }
  }, [isAvailable]);

  // Seek
  const seekTo = useCallback(async (position: number) => {
    if (!isInitialized || !isAvailable) return;
    try {
      await Media3.seekTo({ position });
    } catch (error) {
      console.error('[Media3] Seek error:', error);
    }
  }, [isInitialized, isAvailable]);

  // Set playback speed
  const setPlaybackSpeed = useCallback(async (speed: number) => {
    if (!isInitialized || !isAvailable) return;
    try {
      await Media3.setPlaybackSpeed({ speed });
    } catch (error) {
      console.error('[Media3] Set speed error:', error);
    }
  }, [isInitialized, isAvailable]);

  // Set quality
  const setQuality = useCallback(async (trackId: string | null) => {
    if (!isInitialized || !isAvailable) return;
    try {
      await Media3.setQualityTrack({ trackId });
      if (trackId === null) {
        await Media3.setABREnabled({ enabled: true });
      } else {
        await Media3.setABREnabled({ enabled: false });
      }
    } catch (error) {
      console.error('[Media3] Set quality error:', error);
    }
  }, [isInitialized, isAvailable]);

  // Enable/disable ABR
  const setABREnabled = useCallback(async (enabled: boolean) => {
    if (!isInitialized || !isAvailable) return;
    try {
      await Media3.setABREnabled({ enabled });
    } catch (error) {
      console.error('[Media3] Set ABR error:', error);
    }
  }, [isInitialized, isAvailable]);

  // Select audio track
  const selectAudioTrack = useCallback(async (trackId: string) => {
    if (!isInitialized || !isAvailable) return;
    try {
      await Media3.selectAudioTrack({ trackId });
    } catch (error) {
      console.error('[Media3] Select audio error:', error);
    }
  }, [isInitialized, isAvailable]);

  // Select subtitle track
  const selectSubtitleTrack = useCallback(async (trackId: string | null) => {
    if (!isInitialized || !isAvailable) return;
    try {
      await Media3.selectSubtitleTrack({ trackId });
    } catch (error) {
      console.error('[Media3] Select subtitle error:', error);
    }
  }, [isInitialized, isAvailable]);

  // Set max resolution
  const setMaxResolution = useCallback(async (maxHeight: number) => {
    if (!isInitialized || !isAvailable) return;
    try {
      await Media3.setMaxResolution({ maxHeight });
    } catch (error) {
      console.error('[Media3] Set max resolution error:', error);
    }
  }, [isInitialized, isAvailable]);

  // Enter fullscreen
  const enterFullscreen = useCallback(async () => {
    if (!isInitialized || !isAvailable) return;
    try {
      await Media3.enterFullscreen();
    } catch (error) {
      console.error('[Media3] Enter fullscreen error:', error);
    }
  }, [isInitialized, isAvailable]);

  // Exit fullscreen
  const exitFullscreen = useCallback(async () => {
    if (!isAvailable) return;
    try {
      await Media3.exitFullscreen();
    } catch (error) {
      console.error('[Media3] Exit fullscreen error:', error);
    }
  }, [isAvailable]);

  // Cleanup
  const cleanup = useCallback(async () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    
    listenersRef.current.forEach(listener => listener.remove());
    listenersRef.current = [];
    
    if (isAvailable) {
      try {
        await Media3.removeAllListeners();
        await Media3.stop();
      } catch (e) {
        console.warn('[Media3] Cleanup warning:', e);
      }
    }
    
    setIsInitialized(false);
    setPlaybackState(null);
    setQualityTracks([]);
    setCurrentQuality(null);
    setAudioTracks([]);
    setSubtitleTracks([]);
  }, [isAvailable]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isAvailable,
    isInitialized,
    isLoading,
    playbackState,
    qualityTracks,
    currentQuality,
    audioTracks,
    subtitleTracks,
    networkInfo,
    initialize,
    play,
    pause,
    stop,
    seekTo,
    setPlaybackSpeed,
    setQuality,
    setABREnabled,
    selectAudioTrack,
    selectSubtitleTrack,
    setMaxResolution,
    enterFullscreen,
    exitFullscreen,
    cleanup,
  };
}

/**
 * Check if the app should use Media3 for video playback
 * Returns true only on Android native platform
 */
export function shouldUseMedia3(): boolean {
  return isMedia3Available();
}

/**
 * Get quality label from track
 */
export function getQualityLabel(track: QualityTrack): string {
  if (track.label) return track.label;
  if (track.height >= 2160) return '4K';
  if (track.height >= 1440) return '2K';
  if (track.height >= 1080) return '1080p';
  if (track.height >= 720) return '720p';
  if (track.height >= 480) return '480p';
  if (track.height >= 360) return '360p';
  return `${track.height}p`;
}
