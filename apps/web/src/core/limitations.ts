export const privacyTooltip = [
  "이 웹 버전은 선택한 폴더와 작성한 노트를 서버로 업로드하지 않고 브라우저 안에서만 분석합니다.",
  "Chrome/Edge의 폴더 선택이 가장 안정적이며, 사용자가 명시적으로 허용한 폴더만 읽을 수 있습니다.",
  "브라우저 배포판은 Git 브랜치, HEAD, dirty 상태, 커밋 변경 영향 분석을 제공하지 않습니다.",
  "노트와 컬렉션은 OPFS/브라우저 저장소에 남기 때문에 브라우저 데이터 삭제나 저장소 정리 시 사라질 수 있고, 백업 기능은 아직 없습니다.",
  "웹 분석은 gitignore를 완전히 해석하지 않고 node_modules, dist, build 같은 생성 폴더를 보수적으로 제외합니다.",
  "Confluence용 리치 클립보드, 데스크탑 자동 업데이트 같은 네이티브 기능은 데스크탑 앱에서만 지원됩니다.",
  "지원 언어: Java(.java), Python(.py), PHP(.php), TypeScript(.ts/.tsx)",
];

export const privacyTooltipText = privacyTooltip.join(" ");

export const BROWSER_LIMITATIONS = [
  {
    feature: "repositoryAccess",
    status: "limited",
    summary: "브라우저 권한으로 선택한 폴더만 읽습니다.",
    detail:
      "폴더 선택은 사용자의 명시적 브라우저 권한으로만 동작합니다. 선택한 소스 파일은 업로드하지 않고 메모리에서만 읽으며, 새로 접속하면 브라우저가 다시 권한 확인을 요구할 수 있습니다.",
  },
  {
    feature: "persistence",
    status: "limited",
    summary: "분석 결과와 문서만 브라우저 저장소에 보관합니다.",
    detail:
      "OPFS에 저장되는 데이터는 심볼, 호출 관계, 노트, 컬렉션, 화면 상태입니다. 원본 소스 코드는 저장하지 않으므로 복구 후 다시 폴더를 열어야 소스 보기가 가능합니다.",
  },
  {
    feature: "gitImpact",
    status: "unsupported",
    summary: "웹 배포판에서는 Git 변경 영향 분석을 제공하지 않습니다.",
    detail:
      "브라우저는 로컬 Git 명령과 커밋 히스토리에 직접 접근할 수 없어서 데스크톱 앱의 변경된 코드 확인하기 기능은 지원하지 않습니다. 같은 기능이 필요하면 데스크톱 앱을 사용해야 합니다.",
  },
  {
    feature: "languageCoverage",
    status: "limited",
    summary: "Java, Python, PHP, TypeScript/TSX를 정적 파싱합니다.",
    detail:
      "브라우저판은 Tree-sitter WASM으로 함수와 메서드 선언, 직접 호출 후보를 정적으로 추출합니다. 동적 호출, 런타임 DI, 리플렉션, 빌드 설정 기반 타입 추론은 제한됩니다.",
  },
] as const;

export function unsupportedChangeImpact() {
  return {
    supported: false,
    reason:
      "웹 배포판은 로컬 Git 커밋과 작업 트리에 접근하지 않습니다. 분석 이후 변경된 코드의 영향을 확인하려면 데스크톱 앱에서 변경된 코드 확인하기를 사용하세요.",
  } as const;
}
