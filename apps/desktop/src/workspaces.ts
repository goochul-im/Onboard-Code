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
] as const;

export type Workspace = typeof workspaces[number]["id"];

export const defaultWorkspace: Workspace = "explore";
