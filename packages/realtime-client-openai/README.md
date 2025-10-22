# @charivo/realtime-client-openai

OpenAI Realtime API client with WebRTC support for low-latency voice conversations.

## Features

- 🌐 **WebRTC Connection** - Low-latency peer-to-peer audio streaming
- 🎤 **Auto Microphone** - Automatic microphone input handling
- 🔊 **Auto Playback** - Automatic audio playback through browser
- 💋 **Real-time Lip-Sync** - 60fps RMS calculation via Web Audio API
- 📡 **Event Streaming** - Text and audio delta events
- 🔐 **Secure** - API key stays on server, client only gets SDP answer

## Installation

```bash
pnpm add @charivo/realtime-client-openai @charivo/realtime-core
```

## Usage

### Basic Setup

```typescript
import { createOpenAIRealtimeClient } from "@charivo/realtime-client-openai";
import { createRealtimeManager } from "@charivo/realtime-core";

// Create client pointing to your WebRTC handshake endpoint
const client = createOpenAIRealtimeClient({
  apiEndpoint: "/api/realtime"
});

// Wrap with RealtimeManager
const realtimeManager = createRealtimeManager(client);

// Start session
await realtimeManager.startSession({
  model: "gpt-4o-realtime-preview-2024-12-17",
  voice: "verse"
});

// Send a message
await realtimeManager.sendMessage("Hello!");

// Cleanup
await realtimeManager.stopSession();
```

### Server-Side Endpoint (Next.js)

Create a server endpoint to handle the WebRTC handshake (unified interface):

```typescript
// app/api/realtime/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new NextResponse("Missing OpenAI API key", { status: 500 });
  }

  // Get SDP offer from client
  const sdpOffer = await request.text();

  // Create session config
  const sessionConfig = {
    type: "realtime",
    model: "gpt-4o-realtime-preview-2024-12-17",
    audio: {
      output: {
        voice: "verse" // or "alloy", "echo", "shimmer"
      }
    }
  };

  // Send to OpenAI
  const formData = new FormData();
  formData.set("sdp", sdpOffer);
  formData.set("session", JSON.stringify(sessionConfig));

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    return new NextResponse("Failed to create session", { status: 500 });
  }

  // Return SDP answer to client
  const sdpAnswer = await response.text();
  return new NextResponse(sdpAnswer, {
    headers: { "Content-Type": "application/sdp" },
  });
}
```

### With Charivo Integration

```typescript
import { Charivo } from "@charivo/core";
import { createOpenAIRealtimeClient } from "@charivo/realtime-client-openai";
import { createRealtimeManager } from "@charivo/realtime-core";

const charivo = new Charivo();

// Create Realtime setup
const client = createOpenAIRealtimeClient({
  apiEndpoint: "/api/realtime"
});
const realtimeManager = createRealtimeManager(client);
charivo.attachRealtime(realtimeManager);

// Start session
await realtimeManager.startSession({
  model: "gpt-4o-realtime-preview-2024-12-17",
  voice: "verse"
});

// Enable lip-sync
charivo.emit("tts:audio:start", { audioElement: new Audio() });

// Listen to events
charivo.on("tts:lipsync:update", ({ rms }) => {
  console.log("Mouth animation value:", rms); // 0.0 - 1.0
});

charivo.on("realtime:text:delta", ({ text }) => {
  console.log("Streaming response:", text);
});

// Cleanup
await realtimeManager.stopSession();
charivo.emit("tts:audio:end", {});
charivo.detachRealtime();
```

### React Hook Example

```typescript
import { useState, useCallback } from "react";
import { Charivo } from "@charivo/core";
import { createOpenAIRealtimeClient } from "@charivo/realtime-client-openai";
import { createRealtimeManager } from "@charivo/realtime-core";

export function useRealtimeMode({ charivo }: { charivo: Charivo }) {
  const [isRealtimeMode, setIsRealtimeMode] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const enableRealtimeMode = useCallback(async () => {
    setIsConnecting(true);
    try {
      const client = createOpenAIRealtimeClient({
        apiEndpoint: "/api/realtime"
      });
      const realtimeManager = createRealtimeManager(client);
      charivo.attachRealtime(realtimeManager);

      await realtimeManager.startSession({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "verse"
      });

      // Enable lip-sync
      charivo.emit("tts:audio:start", { audioElement: new Audio() });

      setIsRealtimeMode(true);
    } finally {
      setIsConnecting(false);
    }
  }, [charivo]);

  const disableRealtimeMode = useCallback(async () => {
    const realtimeManager = charivo.getRealtimeManager();
    if (realtimeManager) {
      await realtimeManager.stopSession();
    }
    charivo.detachRealtime();
    charivo.emit("tts:audio:end", {});
    setIsRealtimeMode(false);
  }, [charivo]);

  const toggleRealtimeMode = useCallback(async () => {
    if (isRealtimeMode) {
      await disableRealtimeMode();
    } else {
      await enableRealtimeMode();
    }
  }, [isRealtimeMode, enableRealtimeMode, disableRealtimeMode]);

  return {
    isRealtimeMode,
    isConnecting,
    toggleRealtimeMode
  };
}
```

## API Reference

### `createOpenAIRealtimeClient(options)`

Create an OpenAI Realtime API client.

**Parameters:**
- `options.apiEndpoint` - URL to your server endpoint that handles WebRTC handshake

**Returns:** `RealtimeClient`

### `OpenAIRealtimeClient`

#### Methods

##### `connect()`

Establish WebRTC connection with OpenAI Realtime API.

**Flow:**
1. Request microphone access
2. Create RTCPeerConnection
3. Add microphone audio track
4. Create data channel for events
5. Generate SDP offer
6. Send to server endpoint
7. Receive SDP answer
8. Set up audio playback and lip-sync analysis

**Returns:** `Promise<void>`

##### `disconnect()`

Close WebRTC connection and clean up resources.

**Returns:** `Promise<void>`

##### `sendText(text)`

Send a text message through data channel.

**Parameters:**
- `text` - Message text

**Returns:** `Promise<void>`

##### `sendAudio(audio)`

Send audio chunk through data channel.

**Parameters:**
- `audio` - Audio data as ArrayBuffer

**Returns:** `Promise<void>`

##### `onTextDelta(callback)`

Register callback for text streaming.

**Parameters:**
- `callback(text: string)` - Called for each text chunk

##### `onLipSyncUpdate(callback)`

Register callback for real-time RMS values (60fps).

**Parameters:**
- `callback(rms: number)` - Called with RMS value (0.0 - 1.0)

##### `onAudioDone(callback)`

Register callback for audio end.

**Parameters:**
- `callback()` - Called when audio finishes

##### `onError(callback)`

Register callback for errors.

**Parameters:**
- `callback(error: Error)` - Called on error

## How It Works

### WebRTC Unified Interface

This client uses OpenAI's **unified interface** approach:

```
┌─────────┐                  ┌──────────┐                  ┌─────────┐
│ Browser │                  │  Server  │                  │ OpenAI  │
└────┬────┘                  └────┬─────┘                  └────┬────┘
     │                            │                             │
     │ 1. Create SDP offer        │                             │
     ├───────────────────────────>│                             │
     │                            │                             │
     │                            │ 2. Combine SDP + config     │
     │                            ├────────────────────────────>│
     │                            │                             │
     │                            │ 3. Return SDP answer        │
     │                            │<────────────────────────────┤
     │                            │                             │
     │ 4. Set SDP answer          │                             │
     │<───────────────────────────┤                             │
     │                            │                             │
     │ 5. WebRTC peer-to-peer audio/events                     │
     │<────────────────────────────────────────────────────────>│
```

**Benefits:**
- ✅ API key stays on server (secure)
- ✅ Low latency (peer-to-peer after handshake)
- ✅ Automatic audio handling (mic input + speaker output)

### Lip-Sync Analysis

The client uses Web Audio API to extract real-time audio features:

```typescript
// Setup
audioContext = new AudioContext();
analyser = audioContext.createAnalyser();
analyser.fftSize = 256;
analyser.smoothingTimeConstant = 0.8;

// 60fps analysis loop
setInterval(() => {
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(dataArray);

  // Calculate RMS (Root Mean Square)
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const normalized = dataArray[i] / 255;
    sum += normalized * normalized;
  }
  const rms = Math.sqrt(sum / dataArray.length);

  // Amplify for better mouth movement
  const amplifiedRms = Math.min(rms * 3, 1.0);

  callback(amplifiedRms);
}, 1000 / 60);
```

## Voice Options

Available voices:
- `"alloy"` - Neutral, balanced
- `"echo"` - Male, warm
- `"shimmer"` - Female, soft
- `"verse"` - Female, energetic (default in examples)

Set voice in server endpoint:

```typescript
const sessionConfig = {
  type: "realtime",
  model: "gpt-4o-realtime-preview-2024-12-17",
  audio: {
    output: {
      voice: "verse" // Change here
    }
  }
};
```

## Browser Compatibility

Requires:
- WebRTC support (RTCPeerConnection)
- Web Audio API
- MediaDevices API (getUserMedia)

Supported browsers:
- ✅ Chrome/Edge 56+
- ✅ Firefox 50+
- ✅ Safari 11+

## Troubleshooting

### Microphone Permission Denied

```typescript
try {
  await realtimeManager.startSession(config);
} catch (error) {
  if (error.message.includes("Permission denied")) {
    alert("Please allow microphone access to use voice chat");
  }
}
```

### Connection Failed

Check server endpoint:
- Verify OpenAI API key is set
- Check endpoint URL is correct
- Ensure HTTPS in production (required for getUserMedia)

### No Lip-Sync

Make sure to emit activation event:

```typescript
charivo.emit("tts:audio:start", { audioElement: new Audio() });
```

## Related Packages

- [@charivo/realtime-core](../realtime-core) - Realtime session manager
- [@charivo/core](../core) - Core types and interfaces

## References

- [OpenAI Realtime API Docs](https://platform.openai.com/docs/guides/realtime-webrtc)
- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)

## License

MIT
