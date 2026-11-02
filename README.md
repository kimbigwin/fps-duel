# FPS DUEL (Vercel 정적 배포판)

서버 없이 브라우저끼리 직접 연결(WebRTC, PeerJS)하는 1대1 3D FPS입니다.
먼저 방에 들어온 사람이 '방장'이 되어 판정을 맡고, 두 번째 사람이 방장에게 붙습니다.

## Vercel에 올리기 (Node 설치 없이)
1. GitHub에서 새 저장소 생성 (예: fps-duel) → "uploading an existing file" 클릭 → 이 폴더의 파일 5개(index.html, main.js, game.js, map.js, style.css)를 끌어다 놓고 Commit
2. https://vercel.com/new 에서 그 저장소 Import → Framework Preset은 "Other" 그대로 → Deploy
3. 나온 주소(예: https://fps-duel-xxx.vercel.app)를 친구와 같이 열고, 같은 방 코드로 입장

## 내리기(삭제)
Vercel 대시보드 → 프로젝트 → Settings → 맨 아래 "Delete Project".
GitHub 저장소도 지우려면 저장소 Settings → 맨 아래 "Delete this repository".

## 참고
- 연결 중개에 PeerJS 무료 공개 서버(0.peerjs.com)를 씁니다. 연결된 뒤 게임 데이터는 두 브라우저가 직접 주고받습니다.
- 회사망 등 일부 네트워크에선 직접 연결이 막힐 수 있습니다(이 경우 TURN 서버가 필요).
- 규칙(데미지, 승리 킬 수)은 map.js의 RULES, 장애물은 BOXES에서 바꿀 수 있습니다.
