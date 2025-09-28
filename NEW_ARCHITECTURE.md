# Charivo Core - New Architecture Usage

## 새로운 LLM Manager 아키텍처 사용법

### 기본 설정

```typescript
import { Charivo } from "@charivo/core";
import { createLLMManager } from "@charivo/llm-core";
import { createRemoteLLMClient } from "@charivo/llm-client-remote";

// 1. LLM 클라이언트 생성 (stateless)
const llmClient = createRemoteLLMClient({
  apiEndpoint: "/api/chat"
});

// 2. LLM 매니저 생성 (stateful)
const llmManager = createLLMManager(llmClient);

// 3. Charivo 인스턴스 생성 및 설정
const charivo = new Charivo();
charivo.attachLLM(llmManager);

// 4. 캐릭터 추가
charivo.addCharacter({
  id: "hiyori",
  name: "히요리",
  description: "친근한 AI 어시스턴트",
  personality: "밝고 도움이 되는 성격"
});
```

### 다양한 LLM 클라이언트 사용

```typescript
// Remote API 사용 (권장 - 프로덕션)
import { createRemoteLLMClient } from "@charivo/llm-client-remote";
const remoteClient = createRemoteLLMClient({ apiEndpoint: "/api/chat" });

// OpenAI 직접 사용 (개발/테스트용)
import { createOpenAILLMClient } from "@charivo/llm-client-openai";
const openaiClient = createOpenAILLMClient({ apiKey: "your-api-key" });

// 테스트용 Stub
import { createStubLLMClient } from "@charivo/llm-client-stub";
const stubClient = createStubLLMClient();

// 같은 LLM 매니저에 다른 클라이언트 사용 가능
const llmManager = createLLMManager(remoteClient);
```

### 대화 사용

```typescript
// 대화 시작
await charivo.userSay("안녕하세요!", "hiyori");

// 히스토리 관리
const history = charivo.getHistory();
charivo.clearHistory();

// 현재 캐릭터 확인
const currentCharacter = charivo.getCurrentCharacter();
```

### 아키텍처 이점

1. **관심사 분리**: 
   - LLMClient: 단순한 API 호출만 담당
   - LLMManager: 세션 상태, 히스토리, 캐릭터 관리

2. **재사용성**: 
   - 같은 LLM 매니저에 다른 클라이언트 교체 가능
   - 테스트에서는 Stub, 프로덕션에서는 Remote 사용

3. **확장성**: 
   - 새로운 LLM 서비스를 클라이언트로 쉽게 추가
   - 세션 관리 로직은 변경 없이 유지

### 마이그레이션 가이드

#### Before (기존):
```typescript
import { createStubLLMAdapter } from "@charivo/adapter-llm-stub";

const llmAdapter = createStubLLMAdapter();
charivo.attachLLM(llmAdapter);
```

#### After (새 버전):
```typescript
import { createLLMManager } from "@charivo/llm-core";
import { createStubLLMClient } from "@charivo/llm-client-stub";

const client = createStubLLMClient();
const llmManager = createLLMManager(client);
charivo.attachLLM(llmManager);
```