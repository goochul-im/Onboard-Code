export const workspaces = [
  {
    id: "find",
    label: "Find",
    description: "함수를 찾고 저장소를 선택합니다.",
    primarySurface: "search-results",
  },
  {
    id: "understand",
    label: "Understand",
    description: "호출 관계와 소스를 확인합니다.",
    primarySurface: "caller-callee-graph",
  },
  {
    id: "record",
    label: "Record",
    description: "선택한 함수의 분석 문서를 작성합니다.",
    primarySurface: "source-markdown-split",
  },
] as const;

export type Workspace = typeof workspaces[number]["id"];

export const defaultWorkspace: Workspace = "find";
