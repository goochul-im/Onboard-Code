# TODO

## 배포

- [ ] `onboardcode.app`을 운영 PWA에 연결한다.
  - 현재 미등록 상태인 도메인을 등록한다.
  - GitHub Pages용 apex DNS 레코드를 설정한다.
  - GitHub Pages에 사용자 지정 도메인을 등록하고 `apps/web/public/CNAME`을 복원한다.
  - 운영 웹 빌드의 base path를 `/Onboard-Code/`에서 `/`로 전환한다.
  - `https://onboardcode.app/`에서 DNS, HTTPS 인증서, PWA 자산, WebAssembly 로딩과 오프라인 재실행을 검증한다.
  - 사용자 지정 도메인 검증이 끝날 때까지 현재 GitHub Pages 주소를 유지한다.
