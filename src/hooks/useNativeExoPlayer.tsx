import { useEffect, useRef, useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Media3, Media3Config, isMedia3Available, getNetworkStrategy, QualityTrack } from '@/plugins/Media3Plugin';
import { lockToLandscape, lockToPortrait } from './useScreenOrientation';
import { hideStatusBar, showStatusBar } from './useNativeStatusBar';
import { enterVideoFullscreen, exitVideoFullscreen } from './useImmersiveMode';
import { setGlobalFullscreenState } from './useFullscreenState';

interface UseNativeExoPlayerOptions {
  containerRef: React.RefObject<HTMLDivElement>;
  videoUrl: string | null;
  sourceType: 'hls' | 'dash' | 'mp4';
  poster?: string;
  autoPlay?: boolean;
  contentId?: string;
  drmLicenseUrl?: string;
  drmScheme?: 'widevine' | 'playready' | 'clearkey';
}

/**
 * Check if we should use native ExoPlayer (Android native only)
 */
export const shouldUseNativeExoPlayer = (): boolean => {
  if (!Capacitor.isNativePlatform()) return false;
  return Capacitor.getPlatform() === 'android';
};

/**
 * Hook for using native ExoPlayer via Capacitor Media3 plugin
 * Falls back to null if not on Android native
 */
export function useNativeExoPlayer({
  containerRef,
  videoUrl,
  sourceType,
  poster,
  autoPlay = false,
  contentId,
  drmLicenseUrl,
  drmScheme = 'widevine',
}: UseNativeExoPlayerOptions) {
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [qualityTracks, setQualityTracks] = useState<QualityTrack[]>([]);
  const [currentQuality, setCurrentQuality] = useState<string | null>(null);
  const [autoQuality, setAutoQuality] = useState(true);
  
  const isNative = shouldUseNativeExoPlayer();
  const fullscreenStylesRef = useRef<HTMLStyleElement | null>(null);
  const isFullscreenRef = useRef(false);
  const listenersRef = useRef<Array<{ remove: () => void }>>([]);
  
  // Keep ref in sync with state
  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
    setGlobalFullscreenState(isFullscreen);
  }, [isFullscreen]);

  // Initialize player when URL changes
  useEffect(() => {
    if (!isNative || !videoUrl) {
      return;
    }

    const initPlayer = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Check if Media3 plugin is available
        if (!isMedia3Available()) {
          console.warn('[ExoPlayer] Media3 plugin not available, will fallback to web player');
          setIsLoading(false);
          return;
        }

        // Get network-aware settings
        const networkStrategy = await getNetworkStrategy();

        // Configure ExoPlayer using the correct Media3Config interface
        const config: Media3Config = {
          url: videoUrl,
          enableABR: true,
          maxHeight: networkStrategy.maxHeight,
          maxBitrate: networkStrategy.maxBitrate,
          minBufferMs: networkStrategy.minBufferMs,
          maxBufferMs: networkStrategy.maxBufferMs,
          bufferForPlaybackAfterRebufferMs: networkStrategy.bufferForPlaybackAfterRebufferMs,
        };

        // Add DRM config if license URL provided
        if (drmLicenseUrl) {
          config.drmLicenseUrl = drmLicenseUrl;
          config.drmScheme = drmScheme;
        }

        // Initialize the player
        await Media3.initialize(config);
        
        // Set up event listeners
        const playbackListener = await Media3.addListener('playbackStateChanged', (state) => {
          setIsPlaying(state.isPlaying);
          setIsLoading(state.isBuffering);
          setCurrentTime(state.currentPosition / 1000);
          setDuration(state.duration / 1000);
          setBuffered(state.bufferedPosition / 1000);
        });
        listenersRef.current.push(playbackListener);

        const errorListener = await Media3.addListener('error', (err) => {
          console.error('[ExoPlayer] Error:', err.message);
          setError(err.message);
          setIsLoading(false);
        });
        listenersRef.current.push(errorListener);

        // Get available quality tracks
        try {
          const tracksResult = await Media3.getQualityTracks();
          if (tracksResult.tracks) {
            setQualityTracks(tracksResult.tracks);
          }
        } catch (e) {
          console.warn('[ExoPlayer] Failed to get quality tracks:', e);
        }

        setIsReady(true);
        setIsLoading(false);

        // Auto-play if requested
        if (autoPlay) {
          await Media3.play();
        }
      } catch (err) {
        console.error('[ExoPlayer] Init error:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize player');
        setIsLoading(false);
      }
    };

    initPlayer();

    // Cleanup on unmount or URL change
    return () => {
      if (isNative) {
        // Remove all listeners
        listenersRef.current.forEach(listener => listener.remove());
        listenersRef.current = [];
        // Stop the player
        Media3.stop().catch(console.error);
      }
    };
  }, [isNative, videoUrl, autoPlay, drmLicenseUrl, drmScheme]);

  // Player controls
  const play = useCallback(async () => {
    if (!isNative || !isReady) return;
    try {
      await Media3.play();
      setIsPlaying(true);
    } catch (e) {
      console.error('[ExoPlayer] Play error:', e);
    }
  }, [isNative, isReady]);

  const pause = useCallback(async () => {
    if (!isNative || !isReady) return;
    try {
      await Media3.pause();
      setIsPlaying(false);
    } catch (e) {
      console.error('[ExoPlayer] Pause error:', e);
    }
  }, [isNative, isReady]);

  const seek = useCallback(async (timeSeconds: number) => {
    if (!isNative || !isReady) return;
    try {
      await Media3.seekTo({ position: timeSeconds * 1000 });
    } catch (e) {
      console.error('[ExoPlayer] Seek error:', e);
    }
  }, [isNative, isReady]);

  const setPlaybackRate = useCallback(async (rate: number) => {
    if (!isNative || !isReady) return;
    try {
      await Media3.setPlaybackSpeed({ speed: rate });
    } catch (e) {
      console.error('[ExoPlayer] Set speed error:', e);
    }
  }, [isNative, isReady]);

  const setQuality = useCallback(async (trackId: string) => {
    if (!isNative || !isReady) return;
    try {
      await Media3.setQualityTrack({ trackId });
      await Media3.setABREnabled({ enabled: false });
      setCurrentQuality(trackId);
      setAutoQuality(false);
    } catch (e) {
      console.error('[ExoPlayer] Set quality error:', e);
    }
  }, [isNative, isReady]);

  const enableAutoQuality = useCallback(async () => {
    if (!isNative || !isReady) return;
    try {
      await Media3.setABREnabled({ enabled: true });
      await Media3.setQualityTrack({ trackId: null });
      setAutoQuality(true);
      setCurrentQuality(null);
    } catch (e) {
      console.error('[ExoPlayer] Enable auto quality error:', e);
    }
  }, [isNative, isReady]);

  // Apply CSS-based fullscreen styles
  const applyFullscreenStyles = useCallback((entering: boolean) => {
    const container = containerRef.current;
    if (!container) return;

    if (entering) {
      const style = document.createElement('style');
      style.id = 'exoplayer-fullscreen-styles';
      
      style.textContent = `
        .exoplayer-fullscreen-container {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100vw !important;
          width: 100dvw !important;
          height: 100vh !important;
          height: 100dvh !important;
          z-index: 99999 !important;
          background: black !important;
          padding: 0 !important;
          margin: 0 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          overflow: hidden !important;
          touch-action: manipulation !important;
        }

        .exoplayer-fullscreen-container video {
          width: 100% !important;
          height: 100% !important;
          max-width: 100vw !important;
          max-height: 100vh !important;
          object-fit: contain !important;
        }
        
        body.exoplayer-fullscreen-active {
          overflow: hidden !important;
          position: fixed !important;
          width: 100% !important;
          height: 100% !important;
          touch-action: manipulation !important;
        }

        body.exoplayer-fullscreen-active nav,
        body.exoplayer-fullscreen-active [data-bottom-nav],
        body.exoplayer-fullscreen-active .bottom-nav,
        body.exoplayer-fullscreen-active footer,
        body.exoplayer-fullscreen-active header {
          display: none !important;
        }
        
        .exoplayer-fullscreen-container button,
        .exoplayer-fullscreen-container [role="button"] {
          pointer-events: auto !important;
          touch-action: manipulation !important;
          min-width: 44px !important;
          min-height: 44px !important;
        }
      `;
      document.head.appendChild(style);
      fullscreenStylesRef.current = style;

      document.body.classList.add('exoplayer-fullscreen-active');
      container.classList.add('exoplayer-fullscreen-container');
    } else {
      if (fullscreenStylesRef.current) {
        fullscreenStylesRef.current.remove();
        fullscreenStylesRef.current = null;
      }

      document.body.classList.remove('exoplayer-fullscreen-active');
      container.classList.remove('exoplayer-fullscreen-container');
    }
  }, [containerRef]);

  // Fullscreen toggle with landscape rotation
  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    try {
      if (!isFullscreen) {
        // ENTERING FULLSCREEN - rotate to landscape
        console.log('[ExoPlayer] Entering fullscreen, rotating to landscape');
        
        // Set theme color to black
        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
          themeColorMeta.setAttribute('content', '#000000');
        }

        // Enter fullscreen mode with immersive UI
        await enterVideoFullscreen(container, async () => {
          await lockToLandscape();
        });

        // Double-tap landscape lock for reliable rotation on OEM devices
        await new Promise(resolve => setTimeout(resolve, 150));
        await lockToLandscape();
        
        // Hide status bar
        await hideStatusBar();
        await new Promise(resolve => setTimeout(resolve, 50));
        await hideStatusBar();

        // Apply fullscreen CSS
        applyFullscreenStyles(true);

        setIsFullscreen(true);
      } else {
        // EXITING FULLSCREEN - rotate back to portrait
        console.log('[ExoPlayer] Exiting fullscreen, rotating to portrait');
        
        // Restore theme color
        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
          const isDarkMode = document.documentElement.classList.contains('dark');
          themeColorMeta.setAttribute('content', isDarkMode ? '#0f1419' : '#ffffff');
        }

        // Remove fullscreen CSS first
        applyFullscreenStyles(false);

        // Exit fullscreen mode
        await exitVideoFullscreen(async () => {
          await lockToPortrait();
        });

        // Show status bar
        await showStatusBar();

        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('[ExoPlayer] Fullscreen toggle error:', error);
      applyFullscreenStyles(false);
      setIsFullscreen(false);
    }
  }, [isFullscreen, containerRef, applyFullscreenStyles]);

  // Periodically enforce immersive mode when in fullscreen
  useEffect(() => {
    if (!isFullscreen || !isNative) return;

    const enforceInterval = setInterval(() => {
      if (isFullscreenRef.current) {
        hideStatusBar();
      }
    }, 1000);

    return () => clearInterval(enforceInterval);
  }, [isFullscreen, isNative]);

  return {
    isNative,
    isReady,
    isPlaying,
    isFullscreen,
    isLoading,
    currentTime,
    duration,
    buffered,
    error,
    qualityTracks,
    currentQuality,
    autoQuality,
    // Controls
    play,
    pause,
    seek,
    setPlaybackRate,
    setQuality,
    enableAutoQuality,
    toggleFullscreen,
  };
}
