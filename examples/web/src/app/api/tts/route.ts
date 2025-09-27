import { NextRequest, NextResponse } from "next/server";
import { createOpenAITTSAdapter } from "@charivo/adapter-tts-openai";

// TTS Provider 타입 정의
type TTSProvider = "openai"; // 필요시 "elevenlabs", "azure" 등 추가 가능

// TTS Provider 설정
const TTS_PROVIDER = (process.env.TTS_PROVIDER as TTSProvider) || "openai";

// OpenAI TTS Adapter 초기화 (서버사이드)
const openaiAdapter = createOpenAITTSAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultVoice: "alloy",
  defaultModel: "tts-1-hd",
});

/**
 * TTS Provider별 처리 함수들
 */
const ttsProviders = {
  async openai(text: string, options: any) {
    return await openaiAdapter.generateSpeech(text, {
      voice: options.voice,
      rate: options.speed,
      format: options.format,
    });
  },

  // 추가 가능한 제공자들 (예시)
  /*
  async elevenlabs(text: string, options: any) {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${options.voice}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY!
      },
      body: JSON.stringify({ text })
    });
    return await response.arrayBuffer();
  },

  async azure(text: string, options: any) {
    // Azure Speech SDK implementation
    // ... Azure TTS 구현
  }
  */
};

export async function POST(request: NextRequest) {
  try {
    const {
      text,
      voice = "alloy",
      model = "tts-1-hd",
      speed = 1.0,
      format = "mp3",
      provider = TTS_PROVIDER, // 클라이언트에서 provider 지정 가능
    } = await request.json();

    // 입력 검증
    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required and must be a string" },
        { status: 400 },
      );
    }

    // 지원하지 않는 provider 체크
    if (!ttsProviders[provider as TTSProvider]) {
      return NextResponse.json(
        {
          error: `Unsupported TTS provider: ${provider}`,
          availableProviders: Object.keys(ttsProviders),
        },
        { status: 400 },
      );
    }

    console.log(`🔊 Generating speech using ${provider.toUpperCase()} TTS:`, {
      text: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
      voice,
      model,
      speed,
      format,
    });

    // 선택된 provider로 TTS 생성
    const audioBuffer = await ttsProviders[provider as TTSProvider](text, {
      voice,
      model,
      speed,
      format,
    });

    // Content-Type 매핑
    const contentTypeMap = {
      mp3: "audio/mpeg",
      opus: "audio/opus",
      aac: "audio/aac",
      flac: "audio/flac",
    };

    const contentType =
      contentTypeMap[format as keyof typeof contentTypeMap] || "audio/mpeg";

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": audioBuffer.byteLength.toString(),
        "X-TTS-Provider": provider, // 어떤 provider를 사용했는지 헤더에 포함
      },
    });
  } catch (error) {
    console.error(`TTS API Error (${TTS_PROVIDER}):`, error);

    return NextResponse.json(
      {
        error: "Failed to generate speech",
        provider: TTS_PROVIDER,
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * TTS Provider 정보를 반환하는 GET 엔드포인트
 */
export async function GET() {
  try {
    return NextResponse.json({
      currentProvider: TTS_PROVIDER,
      availableProviders: Object.keys(ttsProviders),
      providerInfo: {
        openai: {
          name: "OpenAI TTS",
          voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
          models: ["tts-1", "tts-1-hd"],
          formats: ["mp3", "opus", "aac", "flac"],
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          "Failed to get provider info" +
          (error instanceof Error ? `: ${error.message}` : ""),
      },
      { status: 500 },
    );
  }
}
