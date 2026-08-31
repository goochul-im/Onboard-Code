export interface AnalysisHelpItem {
  label: string;
  detail: string;
}

export interface AnalysisHelpSection {
  title: string;
  items: AnalysisHelpItem[];
}

export const analysisHelpSections: AnalysisHelpSection[] = [
  {
    title: "지원 언어",
    items: [
      { label: "Java", detail: ".java" },
      { label: "PHP", detail: ".php" },
      { label: "Python", detail: ".py" },
      { label: "TypeScript", detail: ".ts · .tsx · .mts · .cts" },
    ],
  },
];
