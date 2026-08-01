function App() {
  return (
    <main className="app-shell">
      <section className="welcome-card" aria-labelledby="welcome-title">
        <p className="eyebrow">LOCAL-FIRST CODE NOTEBOOK</p>
        <h1 id="welcome-title">코드 그래프 노트</h1>
        <p>
          Java와 Python의 함수 호출 흐름을 탐색하고, 이해한 내용을 함수별로 직접 기록하세요.
        </p>
        <p className="privacy-note">
          모든 분석과 노트는 이 컴퓨터에서만 처리됩니다. 코드 내용은 외부로 전송되지 않습니다.
        </p>
      </section>
    </main>
  );
}

export default App;
