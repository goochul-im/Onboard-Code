export const workspaces = [
  {
    id: "explore",
    label: "Explore",
    description: "함수를 찾고 호출 관계를 탐색합니다.",
    primarySurface: "search-and-call-graph",
  },
  {
    id: "record",
    label: "Record",
    description: "선택한 함수의 분석 문서를 작성합니다.",
    primarySurface: "source-markdown-split",
  },
  {
    id: "collections",
    label: "Collections",
    description: "기능별 함수 탐색 묶음을 만들고 검토합니다.",
    primarySurface: "feature-flow-collection",
  },
] as const;

export type Workspace = typeof workspaces[number]["id"];

export const defaultWorkspace: Workspace = "explore";
