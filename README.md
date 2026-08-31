# 코드 그래프 노트

로컬 Git 저장소의 Java·PHP·Python·TypeScript 함수 호출 관계를 탐색하고, 개발자가 함수별 노트를 직접 작성하는 macOS·Windows 데스크톱 앱입니다.

## 로컬 전용 원칙

- 선택한 저장소는 읽기 전용으로 분석합니다.
- 코드, 노트, 분석 결과와 경로를 외부로 전송하지 않습니다.
- 업데이트 확인 시 앱 버전과 운영체제·아키텍처 정보만 GitHub Release 엔드포인트로 전송합니다.
- 노트와 분석 인덱스는 운영체제의 앱 데이터 디렉터리에 있는 SQLite DB에만 저장합니다.

## 사용 방법

1. 앱에서 **저장소 열기**를 누르고, 컴퓨터에 이미 있는 Git 저장소 폴더를 선택합니다.
2. **코드 분석**을 실행합니다. 버튼의 `?` 도움말에서 지원 언어를 확인할 수 있으며, `.gitignore`가 적용된 `.java`, `.php`, `.py`, `.ts`, `.tsx`, `.mts`, `.cts` 파일만 읽습니다.
3. 왼쪽에서 클래스·파일 그룹을 펼치거나 함수를 검색하고, 중앙 그래프에서 caller/callee를 1~3단계로 펼칩니다.
4. Record에서 코드를 일반 드래그해 복사하거나, macOS에서는 `Command`, Windows에서는 `Ctrl`을 누른 채 클릭·드래그해 줄 참조를 노트에 넣습니다. 문서의 `[line:31]` 참조를 클릭하면 해당 코드로 돌아갈 수 있습니다.

정적으로 확정할 수 없는 호출은 그래프의 확정 연결로 보이지 않으며, `후보가 여러 개` 또는 `대상을 찾지 못함`으로 표시합니다. TypeScript에서는 명시적으로 타입이 선언된 생성자 주입 프로퍼티와 상대 import를 따라 호출 대상을 좁힙니다. PHP에서는 네임스페이스와 `$this->method()`, `Class::method()` 호출을 해석합니다. reflection, 런타임 provider token, 동적 import, monkey patching은 현재 정확도 범위 밖입니다.

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

Tauri 번들은 각 운영체제에서 생성합니다. macOS에서는 `.app`과 DMG를, Windows에서는 WiX 의존성이 없는 NSIS `-setup.exe`를 해당 OS에서 빌드합니다. 업데이트 서명은 구성되어 있으며 Apple·Microsoft 배포 인증서를 이용한 운영체제 코드 서명은 별도 설정이 필요합니다.

GitHub Actions의 **Release desktop app**을 실행하면 macOS·Windows 설치 파일과 서명된 업데이트 메타데이터를 GitHub Release에 게시합니다. 최초 설치 이후에는 앱 상단의 업데이트 버튼으로 새 버전을 받을 수 있습니다. 서명 키 설정과 배포 순서는 [릴리스 가이드](docs/releasing.md)를 참고하세요.

## 데이터 보존

- DB에는 repository 등록 정보, 분석 인덱스, 그래프 상태, 함수 노트와 태그가 저장됩니다.
- 파일 이동 뒤 FQN과 signature가 일치하면 노트를 새 함수로 다시 연결합니다.
- 함수 이름이 바뀌거나 삭제되어 안전한 자동 연결이 불가능하면 노트를 삭제하지 않고 `연결 필요 노트`로 보관합니다.
- 아직 로컬 DB 백업·내보내기와 수동 재연결 UI는 제공하지 않습니다.

자세한 요구사항과 구현 순서는 [구현 계획](.omx/plans/local-code-graph-notebook-plan.md)을 참고하세요.
