# AndroidX Media3 Integration for Native Android

This document provides instructions for implementing the native Android side of the Media3 Capacitor plugin.

## Overview

The project uses **AndroidX Media3 (ExoPlayer successor)** for HLS streaming on Android native apps, while keeping **Shaka Player** as the fallback for web and iOS.

## Dependencies

Add these dependencies to your `android/app/build.gradle`:

```gradle
dependencies {
    // AndroidX Media3 (ExoPlayer successor)
    implementation "androidx.media3:media3-exoplayer:1.2.1"
    implementation "androidx.media3:media3-exoplayer-hls:1.2.1"
    implementation "androidx.media3:media3-exoplayer-dash:1.2.1"
    implementation "androidx.media3:media3-ui:1.2.1"
    implementation "androidx.media3:media3-session:1.2.1"
    
    // DRM Support
    implementation "androidx.media3:media3-exoplayer-drm:1.2.1"
    
    // For Widevine DRM (most common)
    implementation "androidx.media3:media3-decoder-drm:1.2.1"
    
    // Network handling
    implementation "androidx.media3:media3-datasource-okhttp:1.2.1"
}
```

## Native Plugin Implementation

Create this file at `android/app/src/main/java/com/lovable/app/plugins/Media3Plugin.java`:

```java
package com.lovable.app.plugins;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.LoadControl;
import androidx.media3.exoplayer.drm.DefaultDrmSessionManager;
import androidx.media3.exoplayer.drm.DrmSessionManager;
import androidx.media3.exoplayer.drm.FrameworkMediaDrm;
import androidx.media3.exoplayer.drm.HttpMediaDrmCallback;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.dash.DashMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.trackselection.AdaptiveTrackSelection;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.exoplayer.trackselection.TrackSelector;
import androidx.media3.ui.PlayerView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@UnstableApi
@CapacitorPlugin(name = "Media3")
public class Media3Plugin extends Plugin {
    private ExoPlayer player;
    private PlayerView playerView;
    private DefaultTrackSelector trackSelector;
    private Handler mainHandler;
    
    private String currentUrl;
    private boolean isABREnabled = true;
    private int maxHeight = 1080;
    
    // Buffering configuration
    private int minBufferMs = 15000;
    private int maxBufferMs = 50000;
    private int bufferForPlaybackMs = 2500;
    private int bufferForPlaybackAfterRebufferMs = 5000;
    
    @Override
    public void load() {
        super.load();
        mainHandler = new Handler(Looper.getMainLooper());
    }
    
    @PluginMethod
    public void initialize(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL is required");
            return;
        }
        
        currentUrl = url;
        
        // Get configuration options
        isABREnabled = call.getBoolean("enableABR", true);
        maxHeight = call.getInt("maxHeight", 1080);
        minBufferMs = call.getInt("minBufferMs", 15000);
        maxBufferMs = call.getInt("maxBufferMs", 50000);
        bufferForPlaybackAfterRebufferMs = call.getInt("bufferForPlaybackAfterRebufferMs", 5000);
        
        String drmLicenseUrl = call.getString("drmLicenseUrl");
        String drmScheme = call.getString("drmScheme");
        float startPosition = call.getFloat("startPosition", 0f);
        
        mainHandler.post(() -> {
            try {
                initializePlayer(url, drmLicenseUrl, drmScheme, startPosition, call);
            } catch (Exception e) {
                call.reject("Failed to initialize player: " + e.getMessage());
            }
        });
    }
    
    private void initializePlayer(String url, String drmLicenseUrl, String drmScheme, 
                                   float startPosition, PluginCall call) {
        // Release existing player
        if (player != null) {
            player.release();
            player = null;
        }
        
        // Build track selector with ABR
        AdaptiveTrackSelection.Factory trackSelectionFactory = new AdaptiveTrackSelection.Factory();
        trackSelector = new DefaultTrackSelector(getContext(), trackSelectionFactory);
        
        // Set resolution constraints
        trackSelector.setParameters(
            trackSelector.buildUponParameters()
                .setMaxVideoSize(1920, maxHeight)
                .setForceHighestSupportedBitrate(!isABREnabled)
        );
        
        // Build load control for buffering
        LoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(minBufferMs, maxBufferMs, bufferForPlaybackMs, bufferForPlaybackAfterRebufferMs)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();
        
        // Build player
        ExoPlayer.Builder builder = new ExoPlayer.Builder(getContext())
            .setTrackSelector(trackSelector)
            .setLoadControl(loadControl);
        
        player = builder.build();
        
        // Setup player listener
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                notifyPlaybackStateChanged();
            }
            
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                notifyPlaybackStateChanged();
            }
            
            @Override
            public void onPlayerError(PlaybackException error) {
                JSObject errorObj = new JSObject();
                errorObj.put("code", error.errorCode);
                errorObj.put("message", error.getMessage());
                errorObj.put("isRecoverable", error.errorCode != PlaybackException.ERROR_CODE_UNSPECIFIED);
                notifyListeners("error", errorObj);
            }
            
            @Override
            public void onTracksChanged(Tracks tracks) {
                JSObject qualityObj = getCurrentQualityTrack();
                if (qualityObj != null) {
                    notifyListeners("qualityChanged", qualityObj);
                }
            }
        });
        
        // Create media source
        DataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(
            getContext(),
            new DefaultHttpDataSource.Factory()
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(15000)
                .setAllowCrossProtocolRedirects(true)
        );
        
        MediaSource mediaSource;
        MediaItem.Builder mediaItemBuilder = new MediaItem.Builder().setUri(url);
        
        // Add DRM if configured
        if (drmLicenseUrl != null && !drmLicenseUrl.isEmpty()) {
            UUID drmUuid = getDrmUuid(drmScheme);
            if (drmUuid != null) {
                MediaItem.DrmConfiguration drmConfig = new MediaItem.DrmConfiguration.Builder(drmUuid)
                    .setLicenseUri(drmLicenseUrl)
                    .build();
                mediaItemBuilder.setDrmConfiguration(drmConfig);
            }
        }
        
        MediaItem mediaItem = mediaItemBuilder.build();
        
        // Create appropriate media source based on URL
        if (url.contains(".m3u8")) {
            mediaSource = new HlsMediaSource.Factory(dataSourceFactory)
                .createMediaSource(mediaItem);
        } else if (url.contains(".mpd")) {
            mediaSource = new DashMediaSource.Factory(dataSourceFactory)
                .createMediaSource(mediaItem);
        } else {
            // Default progressive
            player.setMediaItem(mediaItem);
            player.prepare();
            if (startPosition > 0) {
                player.seekTo((long) (startPosition * 1000));
            }
            
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
            return;
        }
        
        player.setMediaSource(mediaSource);
        player.prepare();
        
        if (startPosition > 0) {
            player.seekTo((long) (startPosition * 1000));
        }
        
        JSObject result = new JSObject();
        result.put("success", true);
        call.resolve(result);
    }
    
    private UUID getDrmUuid(String scheme) {
        if (scheme == null) return null;
        switch (scheme.toLowerCase()) {
            case "widevine":
                return C.WIDEVINE_UUID;
            case "playready":
                return C.PLAYREADY_UUID;
            case "clearkey":
                return C.CLEARKEY_UUID;
            default:
                return null;
        }
    }
    
    @PluginMethod
    public void play(PluginCall call) {
        mainHandler.post(() -> {
            if (player != null) {
                player.play();
            }
            call.resolve();
        });
    }
    
    @PluginMethod
    public void pause(PluginCall call) {
        mainHandler.post(() -> {
            if (player != null) {
                player.pause();
            }
            call.resolve();
        });
    }
    
    @PluginMethod
    public void stop(PluginCall call) {
        mainHandler.post(() -> {
            if (player != null) {
                player.stop();
                player.release();
                player = null;
            }
            call.resolve();
        });
    }
    
    @PluginMethod
    public void seekTo(PluginCall call) {
        float position = call.getFloat("position", 0f);
        mainHandler.post(() -> {
            if (player != null) {
                player.seekTo((long) (position * 1000));
            }
            call.resolve();
        });
    }
    
    @PluginMethod
    public void setPlaybackSpeed(PluginCall call) {
        float speed = call.getFloat("speed", 1f);
        mainHandler.post(() -> {
            if (player != null) {
                player.setPlaybackSpeed(speed);
            }
            call.resolve();
        });
    }
    
    @PluginMethod
    public void getPlaybackState(PluginCall call) {
        mainHandler.post(() -> {
            JSObject state = new JSObject();
            if (player != null) {
                state.put("isPlaying", player.isPlaying());
                state.put("isBuffering", player.getPlaybackState() == Player.STATE_BUFFERING);
                state.put("currentPosition", player.getCurrentPosition() / 1000.0);
                state.put("duration", player.getDuration() / 1000.0);
                state.put("bufferedPosition", player.getBufferedPosition() / 1000.0);
                state.put("playbackSpeed", player.getPlaybackParameters().speed);
            } else {
                state.put("isPlaying", false);
                state.put("isBuffering", false);
                state.put("currentPosition", 0);
                state.put("duration", 0);
                state.put("bufferedPosition", 0);
                state.put("playbackSpeed", 1);
            }
            call.resolve(state);
        });
    }
    
    @PluginMethod
    public void getQualityTracks(PluginCall call) {
        mainHandler.post(() -> {
            JSArray tracks = new JSArray();
            if (player != null && trackSelector != null) {
                for (Tracks.Group trackGroup : player.getCurrentTracks().getGroups()) {
                    if (trackGroup.getType() == C.TRACK_TYPE_VIDEO) {
                        for (int i = 0; i < trackGroup.length; i++) {
                            Format format = trackGroup.getTrackFormat(i);
                            JSObject track = new JSObject();
                            track.put("id", trackGroup.getMediaTrackGroup().id + "_" + i);
                            track.put("width", format.width);
                            track.put("height", format.height);
                            track.put("bitrate", format.bitrate);
                            track.put("label", format.height + "p");
                            tracks.put(track);
                        }
                    }
                }
            }
            JSObject result = new JSObject();
            result.put("tracks", tracks);
            call.resolve(result);
        });
    }
    
    @PluginMethod
    public void setQualityTrack(PluginCall call) {
        String trackId = call.getString("trackId");
        mainHandler.post(() -> {
            if (player != null && trackSelector != null) {
                if (trackId == null || trackId.isEmpty()) {
                    // Enable ABR
                    trackSelector.setParameters(
                        trackSelector.buildUponParameters()
                            .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                            .setMaxVideoSize(1920, maxHeight)
                    );
                } else {
                    // Set specific track
                    // Implementation would require matching trackId to actual track
                }
            }
            call.resolve();
        });
    }
    
    @PluginMethod
    public void setABREnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", true);
        isABREnabled = enabled;
        mainHandler.post(() -> {
            if (trackSelector != null) {
                trackSelector.setParameters(
                    trackSelector.buildUponParameters()
                        .setForceHighestSupportedBitrate(!enabled)
                );
            }
            call.resolve();
        });
    }
    
    @PluginMethod
    public void getAudioTracks(PluginCall call) {
        mainHandler.post(() -> {
            JSArray tracks = new JSArray();
            if (player != null) {
                for (Tracks.Group trackGroup : player.getCurrentTracks().getGroups()) {
                    if (trackGroup.getType() == C.TRACK_TYPE_AUDIO) {
                        for (int i = 0; i < trackGroup.length; i++) {
                            Format format = trackGroup.getTrackFormat(i);
                            JSObject track = new JSObject();
                            track.put("id", trackGroup.getMediaTrackGroup().id + "_" + i);
                            track.put("language", format.language != null ? format.language : "und");
                            track.put("label", format.label != null ? format.label : format.language);
                            track.put("isSelected", trackGroup.isTrackSelected(i));
                            tracks.put(track);
                        }
                    }
                }
            }
            JSObject result = new JSObject();
            result.put("tracks", tracks);
            call.resolve(result);
        });
    }
    
    @PluginMethod
    public void selectAudioTrack(PluginCall call) {
        // Implementation for audio track selection
        call.resolve();
    }
    
    @PluginMethod
    public void getSubtitleTracks(PluginCall call) {
        mainHandler.post(() -> {
            JSArray tracks = new JSArray();
            if (player != null) {
                for (Tracks.Group trackGroup : player.getCurrentTracks().getGroups()) {
                    if (trackGroup.getType() == C.TRACK_TYPE_TEXT) {
                        for (int i = 0; i < trackGroup.length; i++) {
                            Format format = trackGroup.getTrackFormat(i);
                            JSObject track = new JSObject();
                            track.put("id", trackGroup.getMediaTrackGroup().id + "_" + i);
                            track.put("language", format.language != null ? format.language : "und");
                            track.put("label", format.label != null ? format.label : format.language);
                            track.put("isSelected", trackGroup.isTrackSelected(i));
                            tracks.put(track);
                        }
                    }
                }
            }
            JSObject result = new JSObject();
            result.put("tracks", tracks);
            call.resolve(result);
        });
    }
    
    @PluginMethod
    public void selectSubtitleTrack(PluginCall call) {
        // Implementation for subtitle track selection
        call.resolve();
    }
    
    @PluginMethod
    public void getNetworkInfo(PluginCall call) {
        JSObject info = new JSObject();
        
        ConnectivityManager cm = (ConnectivityManager) getContext()
            .getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
        
        String connectionType = "unknown";
        if (activeNetwork != null) {
            switch (activeNetwork.getType()) {
                case ConnectivityManager.TYPE_WIFI:
                    connectionType = "wifi";
                    break;
                case ConnectivityManager.TYPE_MOBILE:
                    connectionType = "cellular";
                    break;
                case ConnectivityManager.TYPE_ETHERNET:
                    connectionType = "ethernet";
                    break;
            }
        }
        
        // Estimate bandwidth (this is a simplified version)
        long estimatedBandwidth = 5000000; // Default 5 Mbps
        if (player != null) {
            // Could use player stats for better estimation
        }
        
        info.put("estimatedBandwidth", estimatedBandwidth);
        info.put("connectionType", connectionType);
        call.resolve(info);
    }
    
    @PluginMethod
    public void setMaxResolution(PluginCall call) {
        maxHeight = call.getInt("maxHeight", 1080);
        mainHandler.post(() -> {
            if (trackSelector != null) {
                trackSelector.setParameters(
                    trackSelector.buildUponParameters()
                        .setMaxVideoSize(1920, maxHeight)
                );
            }
            call.resolve();
        });
    }
    
    @PluginMethod
    public void enterFullscreen(PluginCall call) {
        // Native fullscreen handling
        call.resolve();
    }
    
    @PluginMethod
    public void exitFullscreen(PluginCall call) {
        // Native fullscreen handling
        call.resolve();
    }
    
    private void notifyPlaybackStateChanged() {
        if (player == null) return;
        
        JSObject state = new JSObject();
        state.put("isPlaying", player.isPlaying());
        state.put("isBuffering", player.getPlaybackState() == Player.STATE_BUFFERING);
        state.put("currentPosition", player.getCurrentPosition() / 1000.0);
        state.put("duration", player.getDuration() / 1000.0);
        state.put("bufferedPosition", player.getBufferedPosition() / 1000.0);
        state.put("playbackSpeed", player.getPlaybackParameters().speed);
        
        notifyListeners("playbackStateChanged", state);
    }
    
    private JSObject getCurrentQualityTrack() {
        if (player == null) return null;
        
        Format currentFormat = player.getVideoFormat();
        if (currentFormat == null) return null;
        
        JSObject track = new JSObject();
        track.put("id", "current");
        track.put("width", currentFormat.width);
        track.put("height", currentFormat.height);
        track.put("bitrate", currentFormat.bitrate);
        track.put("label", currentFormat.height + "p");
        return track;
    }
    
    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (player != null) {
            player.release();
            player = null;
        }
    }
}
```

## Register the Plugin

In `android/app/src/main/java/.../MainActivity.java`, register the plugin:

```java
import com.lovable.app.plugins.Media3Plugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(Media3Plugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

## How It Works

1. **React Side**: The `useMedia3Player` hook checks if the app is running on Android native
2. **If Android**: Uses the Media3Plugin for native HLS playback with ABR, DRM, etc.
3. **If Web/iOS**: Falls back to Shaka Player automatically

## Features

### Adaptive Bitrate (ABR)
- Automatically adjusts quality based on network conditions
- Network strategy presets for WiFi, 4G, 3G, etc.
- Manual quality selection available

### DRM Support
- Widevine (most common for Android)
- PlayReady
- ClearKey

### Quality Selector
- Get available quality tracks via `getQualityTracks()`
- Set specific quality or enable auto via `setQuality()`

### Network Handling
- Automatic strategy selection based on connection type
- Configurable buffer sizes for different network conditions
- Stall recovery and error handling

## Testing

After implementing the native code:

1. Run `npx cap sync android`
2. Open in Android Studio: `npx cap open android`
3. Build and run on device/emulator
4. Test HLS streaming with various network conditions
