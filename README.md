# pr-review-extension

GitHub PR 코드 hunk를 Claude Code로 던지고 사이드패널에서 답변 받는 크롬 익스텐션 MVP.

## Setup

1. `npm install` (root)
2. Bridge server 실행: `npm run bridge:start` (port 8765)
3. Chrome → Extensions → Developer mode → Load unpacked → `extension/`

## Usage

GitHub PR diff 페이지에서 코드 선택 → 사이드패널 입력창에 질문 → Enter.
