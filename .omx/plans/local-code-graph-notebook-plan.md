# 로컬 코드 그래프 노트 앱 — v1 구현 계획

## 1. 제품 정의와 확정된 요구사항

개발자가 자신의 컴퓨터에 이미 존재하는 Git 저장소를 **읽기 전용으로** 열고,
Java와 Python의 함수/메서드 호출 관계를 탐색하면서 각 함수에 대한 설명을
직접 작성하는 macOS·Windows 데스크톱 앱을 만든다.

### 확정 사항

- 지원 언어: Java (`.java`), Python (`.py`)
- 저장소 입력: 이미 로컬에 clone된 Git 저장소 폴더 선택
- 그래프 중심 단위: 함수와 메서드의 caller/callee 관계
- 문서: 개발자가 직접 작성하는 함수별 노트; AI 생성·AI 해석은 없음
- 저장 위치: 앱 전용 로컬 SQLite DB; 원본 저장소에는 파일을 쓰지 않음
- 보안: 코드, 노트, 분석 결과, 경로를 외부 서버로 전송하지 않음
- 배포 대상: macOS와 Windows

### v1의 의도적인 범위 제한

- Git clone, 인증, push/pull, 협업, 클라우드 동기화는 포함하지 않는다.
- 코드 편집기/IDE 대체 제품이 아니다. 저장소는 읽기 전용이다.
- 노트는 함수/메서드에만 붙인다. 클래스·파일·모듈 노트와 노트 공유는 다음 단계다.
- Java reflection·Spring DI, Python monkey patching·`getattr`·동적 import처럼
  정적으로 확정할 수 없는 호출은 "미해결" 또는 "추정"으로 보이며, 확정 edge처럼
  표시하지 않는다.
- notebook, bytecode, generated source와 Java annotation processor 결과는 v1에서 제외한다.

## 2. 해결하려는 사용자 흐름

1. 사용자가 **저장소 열기**에서 로컬 Git 폴더를 선택한다.
2. 앱은 Git root와 현재 branch를 확인한 뒤 Java/Python 소스만 분석한다.
3. 사용자는 함수명, 파일명, fully-qualified name으로 함수를 검색한다.
4. 선택한 함수의 소스 위치, 호출하는 함수(caller), 호출되는 함수(callee), 기존 노트를
   한 화면에서 본다.
5. `callee 펼치기` 또는 `caller 펼치기`를 눌러 필요한 관계만 단계적으로 그래프에 추가한다.
   전체 저장소 그래프를 기본으로 그리지 않는다.
6. 어떤 함수든 선택해 설명·주의사항·태그를 저장한다. 앱을 닫거나 Git branch를 바꿔도
   매칭 가능한 노트는 유지한다.

## 3. 권장 기술 아키텍처

```text
React + TypeScript UI
  ├─ 함수 검색 / 코드 미리보기 / Markdown 노트 편집기
  ├─ Cytoscape.js 기반 부분 호출 그래프
  └─ Tauri command API
                 │
Tauri 2 Rust core ─ SQLite (앱 데이터 디렉터리)
  ├─ 선택한 repo에 한정된 read-only filesystem access
  ├─ Git metadata reader
  ├─ index orchestrator / background job / file change watcher
  └─ Tree-sitter Java·Python AST extractors + resolver
                 │
         로컬 Git working tree (절대 쓰지 않음)
```

Tauri 2는 하나의 코드베이스로 macOS와 Windows를 빌드할 수 있고, React 같은 웹 UI와
Rust 애플리케이션 로직을 조합할 수 있어 이 요구에 적합하다. Java와 Python 모두를
파싱할 수 있는 Tree-sitter는 구문 트리와 증분 파싱을 제공하므로, 파일 변경 시 전체
저장소를 매번 다시 읽지 않는 기반으로 사용한다. 다만 Tree-sitter만으로 타입/동적
dispatch를 완벽히 해석할 수는 없으므로 `confidence`가 모델의 일부여야 한다.

### 분석 계층

| 계층 | v1 책임 | 출력 |
| --- | --- | --- |
| AST 추출기 | 선언, 범위, import, 직접 call expression, 위치를 Java/Python에서 추출 | `symbol`, `raw_call` |
| 로컬 resolver | 같은 파일·같은 모듈·명시 import를 우선 연결하고 overload/동명이인을 구분 | `call_edge` + confidence |
| confidence 정책 | 확정 가능한 연결과 모호·동적 연결을 구별 | `resolved`, `ambiguous`, `unresolved` |
| 인덱스 조정기 | 변경 파일만 재분석, 분석 취소/진행 상태, 오류 격리 | `analysis_run`, diagnostics |

Java의 다중 모듈·polymorphism까지 높은 정확도가 필요한 후속 단계에서는 JDT Language
Server를 **선택적 로컬 semantic resolver**로 추가한다. JDT LS는 Java call hierarchy,
Maven/Gradle 프로젝트를 지원하지만 Java 21 runtime을 요구하므로, 이를 최초 v1의
필수 설치 조건으로 만들지 않는다. 먼저 자체 resolver의 정확도/성능을 실제 팀 저장소에서
검증한 뒤 sidecar 제공 여부를 결정한다.

### 데이터 모델

- `repositories`: 앱 관리 repository ID, canonical root path, Git root fingerprint, 마지막 branch/HEAD
- `analysis_runs`: 시작·종료 시각, commit/working-tree fingerprint, 성공/부분 실패 상태
- `symbols`: 언어, kind, FQN, signature, source path·range, normalized AST fingerprint
- `call_edges`: caller/callee, source location, confidence, unresolved callee text
- `notes`: symbol ID, Markdown 본문, tags, 생성·수정 시각
- `symbol_links`: 함수 이동·rename 이후 자동 재연결 후보와 신뢰도
- `graph_preferences`: repository별 마지막 필터·레이아웃·pin 상태
- SQLite FTS5 index: symbol 이름·FQN·경로·노트 검색

노트의 기본 키를 단순 line number가 아닌 `language + FQN + signature + AST fingerprint`로
만든다. branch 전환이나 파일 이동 후에는 (1) 정확한 signature, (2) FQN/파일 이동,
(3) 구조 fingerprint 순으로 재연결한다. 자동 매칭이 안전하지 않으면 노트를 삭제하지 않고
`연결 필요` 보관함으로 이동한다.

## 4. 구현 단계

### 단계 0 — 제품 기준과 대표 저장소 확정

- Java Maven/Gradle 저장소 1개, Python package 저장소 1개, 혼합/대형 저장소 1개를
  익명화 없이 로컬 테스트용으로 선정한다.
- 아래 지원 범위와 `resolved/ambiguous/unresolved` 표기 예시를 짧은 제품 명세로 고정한다.
- 각 저장소에서 개발자가 따라가고 싶은 함수 탐색 시나리오 5개씩을 작성한다.

**완료 기준:** 선정한 3개 저장소와 15개 탐색 시나리오가 있고, 기대하는 함수와 호출 관계가
문서화되어 있다.

### 단계 1 — 데스크톱 골격과 로컬 전용 보안 경계

- `apps/desktop`에 Tauri 2 + React/TypeScript 프로젝트를 생성한다.
- `src-tauri/` command allowlist를 만든다. 파일 선택으로 승인한 repository root와 앱 데이터
  디렉터리 외의 파일은 읽지 못하게 한다.
- 네트워크 API, telemetry, crash-report upload, remote update check를 기본 비활성화한다.
- 앱 데이터 디렉터리에 SQLite DB와 schema migration을 생성하고, repository를 삭제해도
  DB의 노트를 즉시 삭제하지 않는 정책을 구현한다.
- macOS/Windows에서 빈 앱을 package하고, OS별 권한과 DB 경로를 검증한다.

**완료 기준:** 네트워크가 차단된 환경에서 앱을 시작해 DB에 test data를 저장·복원할 수 있으며,
선택하지 않은 경로 및 repository 파일 쓰기 시도는 실패한다.

### 단계 2 — repository 등록과 변경 감지

- native folder picker로 로컬 폴더를 선택하고 `.git` worktree를 검증한다.
- Git metadata를 읽어 root, branch, HEAD, dirty 상태를 표시한다. Git working tree에는 어떤
  파일도 생성·변경하지 않는다.
- `.gitignore`와 사용자가 지정한 exclude 패턴을 적용해 분석 대상 `.java`/`.py` 목록을 만든다.
- file watcher와 수동 `다시 분석`을 제공한다. 분석은 debounce 후 background job으로 돌리고,
  branch/HEAD 변경은 "재분석 필요" 상태로 표시한다.

**완료 기준:** 유효한 Git 저장소는 등록되고, 일반 폴더는 명확한 오류를 보인다. 100개 파일의
수정 또는 branch 변경 후 변경 파일만 다시 분석 대상으로 큐잉된다.

### 단계 3 — Java/Python 정적 인덱서

- Rust Tree-sitter bindings와 Java/Python grammar를 연결한다.
- 클래스·함수·메서드 선언, overload signature, import, call expression, source range를 추출한다.
- 같은 파일/모듈의 확정 연결부터 해석하고, 이름 충돌, virtual dispatch, dynamic call을
  각각 `ambiguous` 또는 `unresolved` edge로 저장한다.
- parse 오류는 파일 단위 diagnostic으로 저장하고, 한 파일 실패가 전체 analysis run을 취소하지
  않게 한다.
- symbol ID, AST fingerprint, rename/move 후보 생성과 orphan note 정책을 구현한다.

**완료 기준:** 단계 0의 15개 시나리오에서 기대한 선언은 100% 인덱싱되고, 확정 가능하다고
정의한 edge의 90% 이상이 정확하다. 불확실한 edge에는 confidence가 빠지지 않는다.

### 단계 4 — 그래프·검색·코드 탐색 UX

- 좌측 repository/파일 필터, 상단 함수 검색, 중앙 그래프, 우측 소스·노트 패널의 단일 창
  레이아웃을 구현한다.
- 그래프는 선택 함수 1개만으로 시작하며 caller/callee를 한 단계씩 펼친다. depth(1~3),
  language, path, confidence 필터와 pin/reset을 제공한다.
- 노드는 FQN·signature·파일·line과 confidence를 보여준다. unresolved node는 다른 함수로
  위장하지 않고 별도 스타일을 쓴다.
- 검색 결과에서 선택하면 해당 노드가 그래프의 중심이 되고, source preview가 정확한 range로
  이동한다.
- 키보드 탐색, 그래프만으로 전달되지 않는 관계의 텍스트 목록, 색상 외 confidence 표기를
  제공한다.

**완료 기준:** 사용자 시나리오에서 시작 함수부터 세 단계 안의 callee를 찾고, 해당 source와
confidence를 볼 수 있다. 그래프 렌더링 실패 시에도 caller/callee 목록으로 같은 탐색이 가능하다.

### 단계 5 — 직접 작성 노트와 검색

- 함수 선택 시 Markdown 노트 editor를 열고 autosave(짧은 debounce)와 명시 저장 상태를 제공한다.
- 태그·마지막 수정일·연결 상태를 저장하고, 노트와 symbol을 한 번에 검색한다.
- rename/move/delete 재분석 후 자동 연결, `연결 필요`, `고아 노트`를 구분하는 검토 화면을
  구현한다. 고아 노트를 자동 삭제하지 않는다.
- DB migration 실패·손상 감지 시 원본 DB를 보존하고 오류 및 복구 안내를 제공한다.

**완료 기준:** 노트를 작성한 뒤 앱 재시작과 repository 재열기 후에도 내용이 유지된다. 함수가
삭제되면 노트가 사라지지 않고 고아 보관함에서 검색·열람된다.

### 단계 6 — 성능·보안·배포 품질 게이트

- reference machine(명시한 CPU/RAM/OS)에서 cold index, 100파일 증분 index, 그래프 펼치기,
  검색의 p95 시간을 기록한다. 초기 목표는 5,000개 이하 Java/Python 파일에서 cold index 2분,
  100파일 증분 index 20초, 1-hop 확장 500ms, 검색 200ms 이하다.
- outbound connection을 기록/차단한 test에서 코드·노트·경로 전송이 0건인지 검증한다.
- Windows installer와 macOS app bundle을 clean machine VM에서 설치·업데이트 없이 실행한다.
- 테스트 저장소로 parser regression suite를 고정하고, macOS/Windows CI에서 실행한다.

**완료 기준:** 목표 성능 또는 측정된 제한 사항이 release notes에 명시되고, 핵심 기능이
오프라인에서 macOS/Windows 모두 통과한다.

## 5. 수용 기준

1. 유효한 로컬 Git 폴더를 선택하면 root, 현재 branch, HEAD/dirty 상태가 보인다.
2. 앱은 `.java`와 `.py`만 분석 대상으로 삼고, parse 실패한 파일 이름·원인을 표시하면서
   나머지 분석을 계속한다.
3. 함수/메서드마다 FQN, signature, 파일·line range가 존재하며 overload와 같은 이름을 구분한다.
4. 사용자는 함수 검색에서 결과를 선택해 caller/callee 그래프와 해당 코드로 이동할 수 있다.
5. 사용자는 caller/callee를 단계적으로 펼치고 depth·경로·언어·confidence로 필터링할 수 있다.
6. 모든 graph edge에는 `resolved`, `ambiguous`, `unresolved` 중 하나가 있고 UI가 이를 식별한다.
7. 선택 함수에 Markdown 노트와 태그를 저장·수정·삭제할 수 있고, 재시작 후 유지된다.
8. 파일 이동/rename 또는 branch 전환으로 자동 매칭에 실패한 노트는 삭제되지 않고 `연결 필요` 또는
   `고아`로 남는다.
9. 네트워크 차단 상태에서도 repository 열기, 분석, 그래프, 검색, 노트 기능이 동작한다.
10. 앱은 원본 repository에 파일을 생성·수정·삭제하지 않으며, 코드·노트·분석 결과·경로를 외부로
    전송하지 않는다.
11. 독립된 clean macOS와 Windows 환경에서 같은 핵심 시나리오를 수행할 수 있다.

## 6. 테스트 전략

| 수준 | 검증 대상 | 예시 |
| --- | --- | --- |
| Unit | parser extractor, resolver, symbol ID/fingerprint, note migration | overload, alias import, 동일 함수명, Python nested function |
| Integration | Git folder 등록 → index → DB → graph query | Maven/Gradle, Python package, dirty working tree, parse-error file |
| E2E | 실제 UI workflow | 함수 검색 → callee 2회 확장 → 노트 저장 → 재시작 → 노트 확인 |
| Security | permission boundary와 outbound traffic | 선택하지 않은 path read 거부, repository write 거부, offline test |
| Cross-platform | macOS/Windows package | clean VM 설치, DB 생성, folder picker, path separator, Unicode path |
| Performance | 대표 세 repository | cold/incremental index와 graph/search p95 기록 |

## 7. 주요 위험과 대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| Python 동적 호출과 Java reflection | 그래프를 사실처럼 오해할 수 있음 | confidence 표기, unresolved node, v1 한계 문서화 |
| Java polymorphism/외부 dependency | 호출 해석률 저하 | source-first resolver로 시작하고 JDT LS sidecar는 검증 후 후속 단계로 분리 |
| 큰 monorepo | 초기 분석과 그래프가 느려짐 | excluded paths, background/취소 가능한 index, partial graph, 성능 게이트 |
| Git branch/rename | 사용자가 쓴 노트가 끊김 | signature+AST fingerprint 재연결과 orphan 보관, 삭제 금지 |
| 내부 코드 보안 | 신뢰 상실 | network 없는 기본 구성, 최소 filesystem scope, traffic test와 privacy 문서 |
| 로컬 DB 유실/손상 | 지식 자산 손실 | atomic migration, versioned backup/내보내기는 v1.1 우선 과제로 명시 |

## 8. 구현 전에 확정할 권장 기본값

아래는 구현을 멈추게 하는 질문이 아니라, 명시적인 기본값으로 시작해 pilot에서 조정할 항목이다.

- Java: Maven/Gradle source tree와 plain `.java`를 우선 지원한다. Eclipse PDE/Ant와 generated source는 제외한다.
- Python: 일반 package/script를 지원하고, notebook과 runtime-generated module은 제외한다.
- 완전 오프라인: v1에는 update check, usage analytics, crash upload도 넣지 않는다.
- 정확도: 확정되지 않은 호출을 숨기지 말고 confidence와 함께 보인다.
- 보존: DB는 앱 데이터 디렉터리에 둔다. v1.1에서 사용자가 선택한 로컬 경로로 암호화된 backup/export를 제공한다.
- 스케일: 5,000 Java/Python 파일 이하를 v1 성능 표본으로 삼고, 초과 시 제한/진행 상태를 사용자에게 알린다.

## 9. 구현 순서와 의존성

```text
0. 대표 저장소·정확도 기준
        ↓
1. Tauri/DB/보안 경계 ──→ 2. 로컬 repository 등록
        ↓                         ↓
3. AST 인덱서·symbol identity ──→ 4. 그래프·검색 UI
                                     ↓
                        5. 노트·rename/orphan 처리
                                     ↓
                         6. 보안·성능·OS별 패키징
```

단계 3의 symbol identity와 confidence 정책이 먼저 안정되어야 단계 4·5의 그래프와 노트가
신뢰할 수 있다. 디자인 시안은 단계 1과 병렬로 만들 수 있지만, 실제 그래프 UI는 인덱서 fixture가
생긴 뒤 구현한다.

## 10. 근거와 후속 결정

- Tauri는 단일 코드베이스로 macOS와 Windows를 포함한 여러 플랫폼을 지원하고, React UI와 Rust
  backend를 조합할 수 있다. 따라서 로컬 filesystem·SQLite·background indexer 경계를 두기에
  적절하다. [Tauri 2 공식 문서](https://v2.tauri.app/start/)
- Tree-sitter는 언어별 concrete syntax tree와 증분 파싱을 제공하며 Java/Python을 포함한 bindings를
  제공한다. 따라서 빠른 source parsing 계층에 적합하지만 semantic call resolution은 별도 계층으로
  다뤄야 한다. [Tree-sitter 소개](https://tree-sitter.github.io/)
- SQLite FTS5는 앱 DB의 full-text search를 지원하므로, 함수와 직접 쓴 노트를 함께 검색하는 데
  적합하다. [SQLite FTS5 문서](https://www.sqlite.org/fts5.html)
- JDT Language Server는 Java call hierarchy와 Maven/Gradle 프로젝트를 지원하지만 Java 21 runtime을
  요구한다. 따라서 첫 로컬 MVP의 필수 의존성이 아니라 정확도 향상 옵션으로 분리한다.
  [Eclipse JDT LS](https://github.com/eclipse-jdtls/eclipse.jdt.ls)
