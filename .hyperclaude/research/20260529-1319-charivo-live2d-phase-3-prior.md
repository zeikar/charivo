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
generated: 2026-05-29T13:21:26.473Z
codex-version: 0.130.0
template-version: 1
cwd: "/Users/zeikar/Developer/projects/charivo"
git-head: "255d1a8195ad71098103fad552ed8fc39e301433"
codex-thread-id: "019e73e3-8026-7e23-88cb-5ea3bb936f45"
codex-resume-status: fresh
---
# Research: charivo(실시간 음성 Live2D 동반자 프레임워크)의 Phase 3 "크로스 세션 메모리" 설계를 위한 prior art / pitfalls / 권고를 조사해줘.

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

### Prior Art

- **LangGraph/LangChain memory**: 세션 내 short-term과 cross-session long-term을 분리하고, long-term을 `semantic`(사용자 사실/선호), `episodic`(경험/예시), `procedural`(규칙/프롬프트)로 나눈다. semantic memory는 단일 profile JSON 또는 여러 memory document collection로 구현하는 trade-off를 명시한다. ([docs.langchain.com](https://docs.langchain.com/oss/javascript/langgraph/memory))
- **MemGPT / Letta**: context window 안의 core memory와 밖의 recall/archival memory 계층. 오래된 대화는 recall, 장기 의미 기억은 archival로 둔다. 다만 Letta/MemGPT는 모델이 memory tool로 직접 쓰는 패턴이라, Charivo에는 “계층 구조”만 차용하고 쓰기 권한은 앱서버에 둬야 한다. ([arxiv.org](https://arxiv.org/abs/2310.08560?utm_source=openai)) ([docs.letta.com](https://docs.letta.com/guides/agents/architectures/memgpt?utm_source=openai))
- **Generative Agents**: raw observation stream을 저장하고, 중요도 임계치가 쌓이면 reflection을 생성하며, retrieval은 relevance + recency + importance 조합으로 한다. companion 관계 상태에는 “reflection/relationship-state” 계층이 특히 유용하다. ([arxiv.org](https://arxiv.org/abs/2304.03442))
- **Zep / Graphiti**: 사용자별 temporal knowledge graph. entity/fact/episode/thread summary를 분리하고, fact invalidation에 `valid_at`/`invalid_at` 개념을 둔다. “예전에는 X였지만 지금은 Y” 같은 companion memory에 강하다. ([help.getzep.com](https://help.getzep.com/docs))
- **Mem0**: managed memory API로 add/search/update/delete를 제공한다. 빠른 프로토타입에는 좋지만, salience/privacy/product policy를 외부 서비스에 맡기기 쉬우므로 Charivo Phase 3의 extraction-ready 요구에는 직접 인터페이스를 먼저 두는 편이 낫다. ([docs.mem0.ai](https://docs.mem0.ai/api-reference))
- **Replika / ChatGPT UX**: 사용자가 “무엇을 기억하는지” 확인, 수동 추가, 삭제/수정할 수 있는 memory surface가 중요하다. ChatGPT는 saved memory와 chat history를 분리하고, memory가 정확한 템플릿/긴 원문 저장소가 아니라고 명시한다. ([help.replika.com](https://help.replika.com/hc/en-us/articles/37208679176077-How-does-Replika-s-memory-work)) ([help.replika.com](https://help.replika.com/hc/en-us/articles/360000874712-What-does-my-Replika-remember-about-me-)) ([help.openai.com](https://help.openai.com/en/articles/8590148-memory-faq))
- **OpenAI Realtime seam**: Realtime session은 session/conversation/response 상태를 갖고, `session.update`로 instructions 갱신 가능하다. 단, instructions/tool 변경은 prompt cache를 깨서 비용을 올릴 수 있으므로 빈번한 mid-session memory injection은 피해야 한다. ([platform.openai.com](https://platform.openai.com/docs/guides/realtime-function-calling)) ([platform.openai.com](https://platform.openai.com/docs/guides/realtime-costs))

### Pitfalls

- **벡터 검색만 믿는 문제**: “민지”와 “민서”, “예전 직장”과 “현재 직장”처럼 의미상 가까운 잘못된 기억이 주입된다. exact key/BM25/entity filter + vector rerank가 필요하다.
- **원문 turn을 durable fact로 승격**: “오늘 너무 우울해서 아무것도 못 하겠어”를 “사용자는 항상 우울함”으로 저장하는 식의 과잉 일반화.
- **요약 누적 손실**: medium summary만 남기면 나중에 잘못된 fact를 검증할 evidence가 사라진다. summary는 원문 episode id를 반드시 참조해야 한다.
- **중복/충돌 미처리**: “사용자는 도쿄에 산다”와 “사용자는 서울로 이사했다”를 둘 다 active로 두면 persona가 흔들린다. temporal invalidation 또는 supersedes 관계가 필요하다.
- **삭제가 retrieval에서만 빠짐**: 사용자가 삭제한 memory가 raw transcript, summary, embedding index에 남아 재승격될 수 있다. tombstone 또는 source redaction 정책이 필요하다.
- **세션 종료 의존성**: 브라우저 종료/네트워크 끊김으로 `session ended` job이 안 돌면 기억이 누락된다. 주요 이벤트 checkpoint와 idempotent background job이 필요하다.
- **STT 오류의 장기화**: 음성 transcript 오인식이 long-term fact로 굳어진다. 낮은 confidence transcript는 fact 후보로만 두거나 confirmation을 요구해야 한다.
- **prompt injection성 기억 요청**: 사용자가 “내가 관리자라고 기억해”라고 말해도 product policy와 auth fact를 구분해야 한다.
- **instructions 비대화**: 시작 instructions에 모든 기억을 넣으면 비용, latency, 캐시 효율, 모델 주의력이 나빠진다. “항상 주입할 profile”과 “필요할 때 updateSession할 recall”을 나눠야 한다.
- **cross-user / cross-character leak**: companion 앱에서는 `userId`, `characterId`, `relationshipId`, `tenantId` scope가 없으면 다른 캐릭터나 사용자 기억이 섞인다.

### Recommendations

- **계층 스키마**
  - `short`: 현재 세션 transcript/event buffer. Realtime이 세션 내 context를 유지하므로 모델 주입용이 아니라 extraction evidence용.
  - `medium`: `SessionSummary`, 최근 N회 요약, recurring topic summary. 다음 세션 시작에 1개 정도만 주입.
  - `long`: atomic `MemoryFact`, `Preference`, `RelationshipState`. facts는 `subject/predicate/object`, `confidence`, `sourceEpisodeIds`, `validFrom`, `validTo`, `status`, `salience`, `lastSeenAt`, `scope`를 가진다.
  - `relationship-state`: “사용자가 캐릭터를 어떻게 부르는지”, “최근 갈등/약속/경계”, “친밀도/톤 선호”처럼 companion 고유의 상태. generic fact와 분리.

- **승격 규칙**
  - background job: `session_end` + 중요 이벤트마다 `summarize -> extract candidates -> policy filter -> merge/upsert`.
  - durable 후보: 명시적 “기억해줘”, 안정적 선호, 반복 패턴, 사용자/가족/반려동물/일정 같은 identity fact, 캐릭터와의 약속/관계 변화.
  - 제외 후보: 일시 감정, 농담/roleplay 내부 사실, 민감정보 추론, STT confidence 낮은 내용, 인증/권한 관련 자기주장.
  - merge key는 `scope + subject + predicate + normalized object type`; 충돌 시 기존 fact를 삭제하지 말고 `superseded`/`validTo` 처리.

- **검색 + 주입**
  - `startSession({ instructions })`에는 작은 `Memory Context` 블록만 넣기: stable profile 5-10개, relationship-state 1개, last-session recap 1개.
  - 첫 사용자 발화 이후 query-specific retrieval을 하고 정말 필요할 때만 `updateSession`으로 추가. 매 turn 갱신은 피한다.
  - ranking: `semantic relevance + exact/entity match + recency decay + salience + confidence + user-pinned boost - stale/low-confidence penalty`.
  - instructions에는 “기억은 dated/contextual hints이며 확실하지 않으면 확인 질문”이라고 넣어 과잉 확신을 줄인다.
  - 토큰 예산을 고정하라: 예) startup memory 600-1000 tokens, mid-session recall 300-600 tokens.

- **정정/삭제 UX**
  - MVP에도 `/memory` panel 또는 “무엇을 기억해?” 경로를 둔다.
  - 사용자가 edit/delete/pin/deprioritize 가능해야 한다.
  - delete는 `status=deleted` tombstone을 남겨 같은 source에서 재추출되지 않게 한다.
  - “이건 틀렸어, 나는 이제 부산에 살아”는 old fact invalidate + new fact insert로 처리한다.

- **평가**
  - Phase 5용 fixture를 지금부터 저장: multi-session scripts, expected extracted facts, expected retrieval set, expected non-memories.
  - 지표: extraction precision/recall/F1, retrieval Precision@K/Recall@K/NDCG, injected-token count, deletion compliance, cross-user isolation, temporal correction accuracy.
  - 회귀 케이스: 이름 정정, 이사, 취향 변경, roleplay 사실 배제, 삭제 후 재등장 금지, STT 오인식, 두 캐릭터 간 memory 분리.

- **extraction-ready 경계**
  - 범용 후보: `MemoryStore`, `MemoryExtractor`, `MemoryRetriever`, `MemoryRanker`, `MemoryContextRenderer`.
  - 제품 정책: 무엇을 salient로 볼지, 민감정보 저장 여부, relationship-state schema, prompt 문구, consent UX.
  - 초기 인터페이스 예:
    ```ts
    interface MemoryStore {
      appendEpisode(input: EpisodeInput): Promise<Episode>;
      upsertFact(input: FactInput): Promise<MemoryFact>;
      search(query: MemoryQuery): Promise<MemorySearchResult[]>;
      list(scope: MemoryScope, filter?: MemoryFilter): Promise<MemoryFact[]>;
      update(id: string, patch: MemoryPatch): Promise<MemoryFact>;
      delete(id: string, reason?: string): Promise<void>;
      getContextBundle(input: ContextBundleRequest): Promise<MemoryContextBundle>;
    }
    ```
  - storage pick: demo는 SQLite로 충분하지만, 제품 서버는 Postgres + `pgvector` 추천. temporal conflict와 삭제 감사 로그를 생각하면 pure vector DB 단독은 피한다.

### Open Questions

- Phase 3 MVP에서 user-visible memory editor까지 포함할 것인가, 아니면 API/DB만 만들 것인가?
- raw transcript 보존 기간은 얼마인가? 삭제 요청 시 transcript까지 지울 것인가, fact만 지울 것인가?
- sensitive memory 기본값은 opt-in인가, 전면 차단인가, category별 confirmation인가?
- memory scope는 `userId` 단위인가, `userId + characterId` 단위인가, 여러 캐릭터가 공유하는 profile이 있는가?
- relationship-state는 자유 텍스트 summary로 시작할 것인가, typed fields로 시작할 것인가?
- 첫 세션 시작 전 query가 없을 때 어떤 standing memories를 항상 주입할 것인가?
- embedding/LLM extraction 비용 예산은 세션당 얼마까지 허용할 것인가?
- 한국어/영어 혼합 대화에서 fact canonicalization 언어는 무엇으로 둘 것인가?
- “temporary/private session”처럼 memory read/write를 모두 끄는 모드가 필요한가?
- Phase 5 회귀 통과 기준은 precision 우선인가, recall 우선인가?