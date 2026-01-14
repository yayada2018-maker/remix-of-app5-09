/**
 * IframeFullscreenWrapper - Dedicated wrapper for iframe/embed video sources
 * Provides fullscreen exit functionality on Android native where iframes
 * don't support custom controls
 * 
 * This component wraps an iframe and provides:
 * 1. Fullscreen toggle button (always visible in fullscreen)
 * 2. Proper orientation handling (landscape in fullscreen)
 * 3. Safe exit back to portrait mode
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { X, Maximize, Minimize } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { lockToLandscape, lockToPortrait } from '@/hooks/useScreenOrientation';
import { enterImmersiveFullscreen, enterAppImmersiveMode } from '@/hooks/useNativeStatusBar';

interface IframeFullscreenWrapperProps {
  embedUrl: string;
  title?: string;
  onBack?: () => void;
  className?: string;
}

export const IframeFullscreenWrapper: React.FC<IframeFullscreenWrapperProps> = ({
  embedUrl,
  title,
  onBack,
  className = '',
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  const isAndroidNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

  // Enter fullscreen
  const enterFullscreen = useCallback(async () => {
    if (isTransitioning) return;
    setIsTransitioning(true);

    try {
      // Step 1: Lock to landscape
      await lockToLandscape();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Step 2: Enter immersive mode (hide status bar and nav bar)
      if (isAndroidNative) {
        await enterImmersiveFullscreen();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Step 3: Request web fullscreen on the container
      if (containerRef.current) {
        try {
          if (containerRef.current.requestFullscreen) {
            await containerRef.current.requestFullscreen({ navigationUI: 'hide' } as any);
          } else if ((containerRef.current as any).webkitRequestFullscreen) {
            await (containerRef.current as any).webkitRequestFullscreen();
          }
        } catch (e) {
          console.log('[IframeFullscreen] Web fullscreen failed:', e);
        }
      }

      // Step 4: Re-apply immersive mode after fullscreen request
      if (isAndroidNative) {
        await new Promise(resolve => setTimeout(resolve, 100));
        await enterImmersiveFullscreen();
      }

      setIsFullscreen(true);
      console.log('[IframeFullscreen] Entered fullscreen');
    } catch (error) {
      console.error('[IframeFullscreen] Enter fullscreen error:', error);
    } finally {
      setIsTransitioning(false);
    }
  }, [isAndroidNative, isTransitioning]);

  // Exit fullscreen
  const exitFullscreen = useCallback(async () => {
    if (isTransitioning) return;
    setIsTransitioning(true);

    try {
      // Step 1: Exit web fullscreen
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
      } catch (e) {
        console.log('[IframeFullscreen] Exit web fullscreen failed:', e);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      // Step 2: Return to app immersive mode (status bar visible, nav bar hidden)
      if (isAndroidNative) {
        await enterAppImmersiveMode();
      }

      // Step 3: Lock back to portrait
      await lockToPortrait();

      setIsFullscreen(false);
      console.log('[IframeFullscreen] Exited fullscreen');
    } catch (error) {
      console.error('[IframeFullscreen] Exit fullscreen error:', error);
    } finally {
      setIsTransitioning(false);
    }
  }, [isAndroidNative, isTransitioning]);

  // Handle back button (Android hardware back)
  useEffect(() => {
    const handleBackButton = (e: PopStateEvent) => {
      if (isFullscreen) {
        e.preventDefault();
        exitFullscreen();
        // Push a state to prevent actual navigation
        window.history.pushState(null, '', window.location.href);
      }
    };

    if (isFullscreen) {
      // Push a state so back button can be intercepted
      window.history.pushState(null, '', window.location.href);
      window.addEventListener('popstate', handleBackButton);
    }

    return () => {
      window.removeEventListener('popstate', handleBackButton);
    };
  }, [isFullscreen, exitFullscreen]);

  // Listen for native fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        // Fullscreen was exited (possibly by browser/system)
        if (isFullscreen) {
          setIsFullscreen(false);
          lockToPortrait();
          if (isAndroidNative) {
            enterAppImmersiveMode();
          }
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [isFullscreen, isAndroidNative]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  return (
    <div
      ref={containerRef}
      className={`relative bg-black ${isFullscreen ? 'fixed inset-0 z-[9999]' : 'w-full aspect-video'} ${className}`}
      style={{
        ...(isFullscreen ? {
          width: '100vw',
          height: '100vh',
          top: 0,
          left: 0,
        } : {}),
      }}
    >
      {/* Iframe */}
      <iframe
        ref={iframeRef}
        src={embedUrl}
        className="w-full h-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        title={title || 'Video Player'}
      />

      {/* Exit Fullscreen Button - Top Left (always visible in fullscreen) */}
      {isFullscreen && (
        <div className="absolute top-0 left-0 z-[60] p-2 sm:p-3 safe-area-top pointer-events-auto">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              exitFullscreen();
            }}
            disabled={isTransitioning}
            className="h-12 w-12 bg-black/70 text-white hover:bg-black/90 backdrop-blur-md rounded-full border-2 border-white/40 transition-all active:scale-90 shadow-lg"
            style={{
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
            }}
          >
            <X className="h-6 w-6" />
          </Button>
        </div>
      )}

      {/* Fullscreen Toggle Button - Bottom Right (always visible) */}
      <div className={`absolute ${isFullscreen ? 'bottom-4 right-4' : 'bottom-2 right-2'} z-[60] pointer-events-auto`}>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFullscreen();
          }}
          disabled={isTransitioning}
          className={`${isFullscreen ? 'h-12 w-12' : 'h-10 w-10'} bg-black/70 text-white hover:bg-black/90 backdrop-blur-md rounded-full border border-white/30 transition-all active:scale-90 shadow-lg`}
          style={{
            WebkitTapHighlightColor: 'transparent',
            touchAction: 'manipulation',
          }}
        >
          {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
        </Button>
      </div>

      {/* Back Button - Top Left (only when NOT fullscreen, for navigation) */}
      {!isFullscreen && onBack && (
        <div className="absolute top-2 left-2 z-[50] pointer-events-auto">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="h-10 w-10 bg-black/50 text-white hover:bg-black/70 rounded-full"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default IframeFullscreenWrapper;
