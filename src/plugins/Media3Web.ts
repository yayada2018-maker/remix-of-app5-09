import { WebPlugin } from '@capacitor/core';
import type { 
  Media3Plugin, 
  Media3Config, 
  PlaybackState, 
  QualityTrack, 
  AudioTrack, 
  SubtitleTrack,
  NetworkInfo 
} from './Media3Plugin';

/**
 * Web implementation of Media3Plugin
 * This is a fallback that logs warnings since Media3 is Android-only.
 * The actual web playback uses Shaka Player directly.
 */
export class Media3Web extends WebPlugin implements Media3Plugin {
  private initialized = false;

  constructor() {
    super();
    console.log('[Media3Web] Web fallback initialized - use Shaka Player for web');
  }

  async initialize(_options: Media3Config): Promise<{ success: boolean }> {
    console.warn('[Media3Web] Media3 is Android-only. Falling back to Shaka Player for web.');
    this.initialized = true;
    return { success: false };
  }

  async play(): Promise<void> {
    if (!this.initialized) {
      console.warn('[Media3Web] Player not initialized');
    }
  }

  async pause(): Promise<void> {
    if (!this.initialized) {
      console.warn('[Media3Web] Player not initialized');
    }
  }

  async stop(): Promise<void> {
    this.initialized = false;
  }

  async seekTo(_options: { position: number }): Promise<void> {
    console.warn('[Media3Web] seekTo not available on web');
  }

  async setPlaybackSpeed(_options: { speed: number }): Promise<void> {
    console.warn('[Media3Web] setPlaybackSpeed not available on web');
  }

  async getPlaybackState(): Promise<PlaybackState> {
    return {
      isPlaying: false,
      isBuffering: false,
      currentPosition: 0,
      duration: 0,
      bufferedPosition: 0,
      playbackSpeed: 1,
    };
  }

  async getQualityTracks(): Promise<{ tracks: QualityTrack[] }> {
    return { tracks: [] };
  }

  async setQualityTrack(_options: { trackId: string | null }): Promise<void> {
    console.warn('[Media3Web] setQualityTrack not available on web');
  }

  async setABREnabled(_options: { enabled: boolean }): Promise<void> {
    console.warn('[Media3Web] setABREnabled not available on web');
  }

  async getAudioTracks(): Promise<{ tracks: AudioTrack[] }> {
    return { tracks: [] };
  }

  async selectAudioTrack(_options: { trackId: string }): Promise<void> {
    console.warn('[Media3Web] selectAudioTrack not available on web');
  }

  async getSubtitleTracks(): Promise<{ tracks: SubtitleTrack[] }> {
    return { tracks: [] };
  }

  async selectSubtitleTrack(_options: { trackId: string | null }): Promise<void> {
    console.warn('[Media3Web] selectSubtitleTrack not available on web');
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const connection = (navigator as any).connection || 
                       (navigator as any).mozConnection || 
                       (navigator as any).webkitConnection;
    
    return {
      estimatedBandwidth: connection?.downlink ? connection.downlink * 1000000 : 5000000,
      connectionType: connection?.type || 'unknown',
    };
  }

  async setMaxResolution(_options: { maxHeight: number }): Promise<void> {
    console.warn('[Media3Web] setMaxResolution not available on web');
  }

  async enterFullscreen(): Promise<void> {
    console.warn('[Media3Web] enterFullscreen not available on web');
  }

  async exitFullscreen(): Promise<void> {
    console.warn('[Media3Web] exitFullscreen not available on web');
  }
}
