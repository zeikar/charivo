---
mode: research
task: |-
  charivo(실시간 음성 Live2D 동반자 프레임워크)의 Phase 3 "크로스 세션 메모리" 설계를 위한 prior art / pitfalls / 권고를 조사해줘.
  
  확정된 아키텍처 제약 (재논의 말 것):
  - 메모리는 @charivo/* core가 아니라 제품 앱/서버 레이어(examples/companion, 신규)에 구현. extraction-ready하게 짜서 나중에 @charivo/memory로 졸업 검토.
  - 세션 '내' 컨텍스트는 OpenAI Realtime 세션이 서버측에서 이미 유지함. 우리가 풀 문제는 '세션 간' 지속성.
  - 주입 seam은 core 변경 없이 startSession({ instructions })에 검색된 기억을 끼우고, 필요시 updateSession으로 갱신. 쓰기는 세션 종료/주요 이벤트 때 앱서버가 요약→필터→저장. 모델이 long-term에 직접 못 씀.
  
  조사 주제:
  1. 메모리 계층 스키마 — short/medium/long-term 분리의 실전 패턴. 무엇을 각 계층에 두나(원문 turn / 요약 / 추출된 fact / relationship-state). 대화형 AI 동반자(Replika류, MemGPT/Letta, generative-agents 등)의 접근과 트레이드오프.
  2. 승격(promotion) 규칙 — 대화를 어떻게 durable fact/요약/관계 업데이트로 올리나. 무엇이 salient한지 판정, 중복 병합, 모델-쓰기 필터링.
  3. 검색(retrieval) + 주입 — 다음 세션 시작 시 무엇을 골라 instructions에 넣나. 임베딩/벡터 검색 vs 최근성 vs 중요도 가중. 토큰 예산 관리(realtime instructions는 비싸다).
  4. 정정/삭제 경로 — 잘못된 기억을 수정/삭제하는 UX·데이터 모델.
  5. 메모리 정밀도(precision) 측정법 — 회귀 감지용 평가 시나리오(로드맵 Phase 5와 연계).
  6. extraction 경계 설계 — 나중에 @charivo/memory로 뽑아낼 때의 MemoryStore 인터페이스 모양. 어디까지가 범용 메커니즘이고 어디부터가 제품 정책인지의 분리선.
  
  산출: prior art / pitfalls / recommendations / open questions 구조로. 권고는 위 제약(앱 레이어, instructions seam, extraction-ready)에 맞춘 구체적 형태로.
slug: charivo-live2d-phase-3-prior
generated: 2026-05-29T13:22:05.727Z
codex-version: claude
template-version: 1
cwd: "/Users/zeikar/Developer/projects/charivo"
git-head: "255d1a8195ad71098103fad552ed8fc39e301433"
codex-resume-status: fresh
---
# Research: charivo(실시간 음성 Live2D 동반자 프레임워크)의 Phase 3 "크로스 세션 메모리" 설계를 위한 prior art / pitfalls / 권고를 조사해줘.

### Prior Art

- **MemGPT / Letta** (https://github.com/letta-ai/letta, paper https://arxiv.org/abs/2310.08560) — OS 가상메모리 비유의 계층 메모리. `main context`(프롬프트에 상주: persona + 사람 정보 + 최근 대화) vs `external context`(recall/archival, 검색으로만 접근). 핵심은 **self-editing via function calls** (`core_memory_append`, `archival_memory_insert`)와 컨텍스트 한계 임박 시 `recursive summarization` paging.
  - charivo 매핑: 계층 분리(main=주입 instructions / external=검색 store)와 recursive summary 패턴은 그대로 채택 가치. **단, self-editing 함수는 명시적 제약 위반** — 우리 결정은 "모델이 long-term에 직접 못 씀". MemGPT의 "모델이 메모리 함수를 호출한다"가 아니라, 모델 출력을 앱서버가 사후 요약→필터→저장하는 단방향으로 뒤집어야 함.
- **Generative Agents** (Park et al., https://arxiv.org/abs/2304.03442) — `memory stream`(타임스탬프 찍힌 관찰 로그) + retrieval score = **recency(지수 감쇠) × importance(LLM이 1–10 채점) × relevance(임베딩 코사인)**. 주기적 `reflection`으로 저수준 관찰을 고수준 통찰(fact)로 승격.
  - charivo 매핑: retrieval 3요소 가중합은 우리 "검색+주입"의 기본 점수 함수로 직접 차용. reflection = 우리의 promotion(요약→fact) 단계. importance 채점은 salience 판정의 출발점. 단 generative-agents는 토큰 예산 무신경 — realtime instructions 비용 때문에 우리는 top-K를 훨씬 빡빡하게 잘라야 함.
- **mem0** (https://github.com/mem0ai/mem0, https://docs.mem0.ai) — 대화에서 LLM으로 fact 추출 → 기존 메모리와 비교해 `ADD / UPDATE / DELETE / NOOP` 결정(=중복 병합 + 모순 해소를 한 단계로). 벡터스토어 + 옵션 그래프.
  - charivo 매핑: ADD/UPDATE/DELETE/NOOP 4-action 병합 결정은 우리 promotion 로직의 거의 완성형 템플릿. 세션 종료 시 추출된 후보 fact를 이 결정 함수에 통과시키면 중복·모순이 자연 흡수됨.
- **Zep / Graphiti** (https://github.com/getzep/zep, https://help.getzep.com) — 시간성 지식그래프(temporal KG): fact에 `valid_at` / `invalid_at`을 달아 "과거엔 참, 지금은 거짓"을 무효화로 표현(삭제가 아니라). 메시지/요약/추출 엔티티 계층 분리.
  - charivo 매핑: 정정 경로를 **destructive delete 대신 supersede(무효화)** 로 모델링하라는 강력한 prior. fact rot/모순 대응의 정석.
- **Replika류 컴패니언** — 공개 아키텍처 문서는 빈약하나 관찰된 패턴: 영속 user profile/관계 카운터(레벨, 호감도) + 사실 메모리 + "기억 편집" UX(사용자가 직접 본 것을 지움). 정확도보다 정서적 연속성·정정 가능성이 제품 가치.
  - charivo 매핑: Phase 4 relationship-state와 직결. 관계 상태는 free-text fact가 아니라 **구조화된 카운터/enum**으로 두는 게 evals와 주입 비용에 유리.
- **LangChain / LlamaIndex memory** (https://python.langchain.com/docs/how_to/chatbots_memory/) — `ConversationSummaryBufferMemory`(최근 원문 버퍼 + 오래된 것 요약), `VectorStoreRetrieverMemory`(검색형). 토큰 임계 넘으면 버퍼를 요약으로 밀어내는 슬라이딩 패턴.
  - charivo 매핑: short(원문 turn 버퍼) → medium(세션 요약) 승격 임계의 검증된 기성 패턴. 단 이건 세션 *내* 문제이고 OpenAI Realtime이 이미 서버측에서 처리하므로, 우리는 이 패턴을 **세션 경계에만** 적용(세션 종료 시 1회 요약).
- **OpenAI Realtime instructions 제약** (https://platform.openai.com/docs/guides/realtime) — `session.instructions`는 system prompt 역할이며 `session.update`로 갱신 가능하나, instructions 토큰은 매 응답 컨텍스트에 상주해 **세션 내내 반복 과금**됨(일반 채팅의 1회성 system이 아님). 또한 audio-token 단가가 높아 긴 instructions는 latency·비용 양쪽에 누적.
  - charivo 매핑: `RealtimeSessionConfig.instructions`(core/src/types.ts:82)가 유일한 주입 seam. 검색된 기억은 여기에 텍스트로 끼워야 하고, 따라서 "주입 예산"이 메모리 설계의 1차 제약.

### Pitfalls

- **Realtime instructions 토큰이 매 turn 누적 과금** — 일반 LLM처럼 "system은 한 번"이 아님. 기억 20개를 욱여넣으면 세션 내내 모든 응답이 그 비용을 짊어짐. 주입은 "이 세션에서 거의 확실히 쓸 것"만. budget을 토큰 수로 명시(예: persona+avatar+memory 합쳐 instructions 상한 정하기).
- **요약 drift / fact rot** — 요약의 요약을 반복하면(MemGPT recursive summary) 디테일이 마모되고 사소한 오류가 굳어짐. 완화: 원문 turn은 medium 승격 후에도 일정 기간/세션 수 보존하고, fact는 요약이 아니라 **원문 turn에서 직접 추출**해 출처(`sourceSessionId`)를 남길 것.
- **모순/시간성 미처리** — "사용자는 부산 거주" 후 "이사함"이 들어오면, 둘 다 fact로 남아 모델이 충돌. 단순 임베딩 검색은 둘 다 끌어와 더 악화. ADD/UPDATE/DELETE 병합 결정 + supersede(valid/invalid 타임스탬프)로만 해결됨.
- **over-injection(무관한 기억 스터핑)** — recency만 쓰면 직전 세션의 잡담이 항상 1순위로 올라와 정작 중요한 오래된 fact를 밀어냄. importance·relevance 없이 recency만 쓰면 컴패니언이 "방금 일만 기억하는" 인상을 줌. 반대로 relevance만 쓰면 세션 시작 시점엔 쿼리가 없어(첫 발화 전) relevance 계산 불가 → cold-start 문제.
- **model-as-writer 환각 fact** — 추출 LLM이 대화에 없던 사실을 지어냄("사용자는 개를 키운다"가 농담이었는데 fact화). 필터 필수: 추출 시 **인용 가능한 turn 근거**를 함께 뽑게 하고, 근거 없으면 폐기. 1인칭 사용자 발화 출처만 fact 후보로, 모델 발화 출처는 배제.
- **privacy/정정 데이터 모델 누락** — 사용자가 "그거 잊어줘"라고 *음성으로* 말해도, 모델은 long-term을 못 쓰므로 즉시 반영 안 됨(다음 세션에야 사라짐). 음성 삭제 요청을 어떻게 캡처해 store에 반영할지 경로가 없으면 "기억 못 지우는 컴패니언"이 됨 → 신뢰 붕괴.
- **embedding 비용·지연 vs recency** — 세션마다 전 메모리 임베딩 재계산은 낭비. fact 저장 시 1회 임베딩하고 캐시. 소규모(수백 건)에선 벡터DB 없이 in-memory 코사인 + recency 정렬로 충분 — 조기 인프라 도입 경계.
- **eval brittleness** — "기억을 정확히 회상하는가"를 정확 문자열 매칭으로 재면 패러프레이즈에 깨짐. LLM-judge는 비결정적. 회귀 감지는 **고정 시드 시나리오 + 구조화된 assertion**(특정 fact id가 검색 top-K에 포함되었는가)로 메커니즘 레벨에서 재는 게 안정적.
- **세션 종료 누락 시 쓰기 손실** — 탭 닫힘/reconnect 실패로 정상 종료 이벤트가 안 오면 그 세션 기억이 통째 유실. 종료 외 "salient event"(주기적 plateau, N turn마다)에도 쓰기 트리거 필요. (참고: realtime-manager는 이미 reconnect/interrupt를 다루므로 종료 신호가 항상 깨끗하진 않음 — packages/realtime/src/realtime-manager.ts.)

### Recommendations

전제: 코드는 모두 `examples/companion`의 app/server에 두고 core 무변경. 주입은 기존 패턴(`buildDemoRealtimeInstructions` → `startSession({ instructions })`, examples/web/src/app/lib/realtime-instructions.ts) 그대로 한 줄 확장.

**(1) 계층 스키마 — short / medium / long**

- **short-term**: 세션 *내* 컨텍스트. 우리가 저장 안 함 — OpenAI Realtime 서버가 이미 보유. 우리 레이어에 short 테이블 만들지 말 것.
- **medium-term (세션 아카이브 + 요약)**: 세션당 1 레코드.
  ```ts
  interface SessionRecord {
    id: string; userId: string;
    startedAt: number; endedAt: number;
    transcript: Turn[];        // 원문 turn (정정·재추출 근거, TTL 보존)
    summary: string;           // 세션 종료 시 LLM 1회 요약
    extractedFactIds: string[];// 이 세션이 만든 fact 역추적
  }
  ```
- **long-term (durable facts + relationship state)**: 두 종류로 분리.
  ```ts
  interface MemoryFact {
    id: string; userId: string;
    text: string;                          // "사용자는 클래식 기타를 친다"
    kind: "preference" | "biographical" | "event" | "other";
    embedding: number[];
    importance: number;                    // 0..1, 추출 시 채점
    sourceSessionId: string; sourceTurnId: string; // 환각 방지 근거
    createdAt: number;
    validAt: number; invalidAt: number | null;     // Zep식 시간성/supersede
    supersededBy: string | null;
  }
  interface RelationshipState {            // free-text 아님: 구조화
    userId: string;
    rapport: number;                       // 0..1 카운터
    sessionCount: number; lastSeenAt: number;
    addressStyle: "formal" | "casual";
    flags: Record<string, boolean>;        // 제품 정책 enum
  }
  ```
  원문 turn은 fact가 아니라 medium에. fact는 추출된 1차 사실만. 관계 상태는 fact와 별 테이블(주입 비용·eval 양쪽 이유).

**(2) 승격(promotion) 규칙** — 세션 종료/salient event 때 앱서버가 실행, 모델 직접 쓰기 금지.

- 파이프라인: `transcript → extract candidates → filter → merge-decide → persist`.
- **extract**: 사용자 발화 turn에서만 후보 추출, 각 후보에 `sourceTurnId` + importance(0–1) 강제. 근거 turn 못 대면 폐기(환각 필터).
- **filter**: importance < 임계(예 0.4) 폐기. 모델 발화 출처 후보 폐기. PII 정책 훅(제품 정책).
- **merge-decide** (mem0식 4-action): 후보를 기존 fact의 top-K 유사군과 비교해 LLM이 `ADD | UPDATE | DELETE | NOOP` 판정. UPDATE/DELETE는 destructive가 아니라 `invalidAt`/`supersededBy` 세팅.
- relationship state는 fact 파이프라인과 분리: 결정론적 규칙(sessionCount++, rapport는 감정 신호 기반 소폭 조정)으로 갱신해 drift 방지.

**(3) 검색 + 주입 (토큰 예산)**

- 점수: `score = wR·recency(decay) + wI·importance + wRel·relevance`. 세션 *시작* 시엔 쿼리가 없으니(cold-start) relevance를 끄고 **recency+importance만으로 top-K**; 세션 중 사용자 발화가 모이면 `updateSession`으로 relevance 포함 재검색해 갱신.
- **토큰 예산 우선**: instructions 합산 상한(persona+avatar 고정분 제외 후 memory 몫, 예: ~600토큰)을 정하고 top-K를 그 안에서 자름. fact는 원문보다 압축적이므로 fact 우선, 세션 요약은 직전 1–2개만.
- 주입은 기존 합성 한 줄 추가:
  ```ts
  // examples/companion app
  instructions: composeInstructions([
    baseCharacterInstructions, avatarInstructions,
    renderMemoryBlock(await memory.retrieve({ userId, budgetTokens: 600 })),
    renderRelationshipBlock(relationship),
  ])
  ```
- 인프라: 수백~수천 fact까지 in-memory 코사인 + recency 정렬로 시작. 벡터DB는 규모 신호 나올 때 도입(조기 도입 금지).

**(4) 정정/삭제 경로**

- 데이터 모델: 모든 fact에 `invalidAt`/`supersededBy` → soft-invalidate가 기본. 검색은 `invalidAt == null`만 후보. 하드 삭제는 GDPR류 "완전 삭제" UX에만.
- UX 2경로: (a) `examples/companion`에 기억 목록/편집 패널(사용자가 fact 보고 끄기/수정 — Replika식). (b) 음성 삭제: 종료 후 추출 단계에서 "잊어줘/그거 아니야" 의도를 감지해 해당 fact를 supersede 후보로 큐잉(모델이 직접 못 쓰므로 앱서버 사후 처리). 즉시성은 다음 세션 시작에 반영됨을 제품 카피로 명시.

**(5) 정밀도 측정 / eval (Phase 5 연계)**

- 메커니즘 레벨(결정론적, 회귀 감지 주력): 고정 시드 대화 fixture → 추출이 기대 fact id 집합을 만드는가, retrieve top-K가 기대 fact를 포함하는가, supersede 후 invalidated fact가 검색에서 빠지는가. 문자열이 아닌 **fact id assertion**으로 안정화.
- 품질 레벨(보조): 소수 LLM-judge 시나리오로 "주입된 기억이 응답에 자연 반영되는가". 비결정적이므로 임계는 느슨하게, 회귀 게이트는 메커니즘 레벨로.
- baseline.md/avatar-prompt-eval 패턴과 동일하게 `docs/`에 시나리오+임계 기록. eval은 라이브 realtime 없이 추출/검색 함수만 단위 호출로 돌 수 있게 설계(빠르고 결정론적).

**(6) extraction 경계 (→ @charivo/memory)**

분리선: **범용 메커니즘 = 저장/검색/시간성/병합의 기계**, **제품 정책 = 무엇이 salient/허용/삭제 대상인가**. 후자는 콜백으로 주입.
```ts
// 졸업 후보: 범용 MemoryStore (메커니즘만)
interface MemoryStore {
  upsertFact(fact: MemoryFact): Promise<void>;
  retrieve(q: {
    userId: string;
    queryEmbedding?: number[];     // 없으면 recency+importance만
    budgetTokens: number;
    weights?: { recency: number; importance: number; relevance: number };
  }): Promise<MemoryFact[]>;       // budget 내 top-K, invalidAt==null만
  supersede(id: string, by: string | null): Promise<void>;
  invalidate(id: string): Promise<void>;
  saveSession(record: SessionRecord): Promise<void>;
}
// 제품 정책 = 앱에 남김 (졸업 안 함):
//  - extractFacts(transcript): 추출 프롬프트/근거 규칙
//  - isSalient(fact) / 임계값 / PII 필터
//  - decideMerge(candidate, neighbors): ADD/UPDATE/DELETE/NOOP 프롬프트
//  - RelationshipState 의미·갱신 규칙
//  - renderMemoryBlock(): instructions 텍스트 포맷
```
즉 `MemoryStore`(+임베딩 어댑터)만 범용으로 졸업 대상. 추출/병합/관계/렌더는 Amadeus 정책이라 앱에 머묾. 이 선을 처음부터 지키면 ROADMAP의 `MemoryManager(memoryStore, …)` 졸업이 자연스러움. companion은 changeset `ignore`에 추가(미발행).

### Open Questions

- 식별 단위: 단일 사용자 디바이스 가정인가, `userId` 기반 멀티유저인가? 인증/식별 경로가 없으면 모든 스키마의 `userId`가 placeholder가 됨.
- 영속 백엔드: companion이 서버 DB(예 SQLite/Postgres)를 가지나, 아니면 브라우저 IndexedDB로 시작하나? 쓰기 위치가 medium/long 스키마의 가용 인프라를 결정.
- 세션 쓰기 트리거: 정상 종료만으로 충분한가, 아니면 N turn마다/주기적 plateau에도 써야 하나(탭 닫힘 유실 방지)? realtime의 reconnect/interrupt 경로에서 "확정된 종료" 신호를 무엇으로 볼지.
- `updateSession`로 세션 중 메모리 재주입을 실제로 할 것인가? (reconnect 비용·instructions 재과금 트레이드오프 — 첫 세션은 cold-start로 최소 주입 후 1회만 보강할지.)
- relationship state의 rapport 같은 카운터를 결정론적 규칙으로 둘지, 모델 신호로 둘지 — Phase 4 persona 설계와 결합되는데 Phase 3에서 어디까지 선반영할지.
- 음성 삭제 요청("잊어줘")의 신뢰 임계: 추출 단계 LLM 판정만으로 supersede할지, 사용자 확인 UX를 거칠지(오삭제 vs 미반영 트레이드오프).
- fact 추출에 별도 LLM 호출을 세션마다 1회 쓰는 비용을 감수하나, 아니면 realtime transcript만으로 규칙 기반 추출부터 시작하나?

관련 파일(절대경로): `/Users/zeikar/Developer/projects/charivo/ROADMAP.md` (Phase 3 결정), `/Users/zeikar/Developer/projects/charivo/packages/core/src/types.ts:77-91` (`RealtimeSessionConfig.instructions` 주입 seam), `/Users/zeikar/Developer/projects/charivo/packages/realtime/src/realtime-manager.ts:165,208` (`startSession`/`updateSession`), `/Users/zeikar/Developer/projects/charivo/examples/web/src/app/lib/realtime-instructions.ts` (instructions 합성 패턴 — companion이 확장할 지점), `/Users/zeikar/Developer/projects/charivo/examples/web/src/app/hooks/useRealtimeMode.ts:69` (`startSession({ instructions })` 호출부).
