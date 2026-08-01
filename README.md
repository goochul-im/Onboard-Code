# 코드 그래프 노트

로컬 Git 저장소의 Java·Python 함수 호출 관계를 탐색하고, 개발자가 함수별 노트를 직접 작성하는 macOS·Windows 데스크톱 앱입니다.

## 로컬 전용 원칙

- 선택한 저장소는 읽기 전용으로 분석합니다.
- 코드, 노트, 분석 결과와 경로를 외부로 전송하지 않습니다.
- 노트와 분석 인덱스는 운영체제의 앱 데이터 디렉터리에 있는 SQLite DB에만 저장합니다.

## 개발 시작

```sh
cd apps/desktop
npm install
npm run tauri dev
```

자세한 요구사항과 구현 순서는 [구현 계획](.omx/plans/local-code-graph-notebook-plan.md)을 참고하세요.
