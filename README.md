# 코드 그래프 노트

로컬 Git 저장소의 Java·Python 함수 호출 관계를 탐색하고, 개발자가 함수별 노트를 직접 작성하는 macOS·Windows 데스크톱 앱입니다.

## 로컬 전용 원칙

- 선택한 저장소는 읽기 전용으로 분석합니다.
- 코드, 노트, 분석 결과와 경로를 외부로 전송하지 않습니다.
- 노트와 분석 인덱스는 운영체제의 앱 데이터 디렉터리에 있는 SQLite DB에만 저장합니다.

## 사용 방법

1. 앱에서 **저장소 열기**를 누르고, 컴퓨터에 이미 있는 Git 저장소 폴더를 선택합니다.
2. **Java·Python 분석**을 실행합니다. `.gitignore`가 적용된 `.java`와 `.py`만 읽습니다.
3. 왼쪽에서 함수를 검색하고, 중앙 그래프에서 caller/callee를 1~3단계로 펼칩니다.
4. 오른쪽에서 코드 위치를 확인하고 노트와 태그를 직접 저장합니다.

정적으로 확정할 수 없는 호출은 그래프의 확정 연결로 보이지 않으며, `후보가 여러 개` 또는 `대상을 찾지 못함`으로 표시합니다. reflection, dependency injection, 동적 import, monkey patching은 v1의 정확도 범위 밖입니다.

## 개발 시작

```sh
cd apps/desktop
npm install
npm run tauri dev
```

## 검증 및 패키징

```sh
cd apps/desktop
npm run check
npm run tauri -- build --debug
```

Tauri 번들은 각 운영체제에서 생성합니다. macOS에서는 `.app`과 DMG를, Windows에서는 설치 프로그램을 해당 OS에서 빌드하세요. 코드 서명과 배포 자동 업데이트는 아직 구성하지 않았습니다.

## 데이터 보존

- DB에는 repository 등록 정보, 분석 인덱스, 그래프 상태, 함수 노트와 태그가 저장됩니다.
- 파일 이동 뒤 FQN과 signature가 일치하면 노트를 새 함수로 다시 연결합니다.
- 함수 이름이 바뀌거나 삭제되어 안전한 자동 연결이 불가능하면 노트를 삭제하지 않고 `연결 필요 노트`로 보관합니다.
- 아직 로컬 DB 백업·내보내기와 수동 재연결 UI는 제공하지 않습니다.

자세한 요구사항과 구현 순서는 [구현 계획](.omx/plans/local-code-graph-notebook-plan.md)을 참고하세요.
