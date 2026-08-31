export function formatUpdateProgress(version: string, downloaded: number, total: number): string {
  if (total <= 0) return `v${version} 다운로드 중…`;
  const percentage = Math.min(100, Math.floor((downloaded / total) * 100));
  return `v${version} 다운로드 ${percentage}%`;
}
