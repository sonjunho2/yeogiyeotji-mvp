# 여기였지 Node.js MVP API

외부 패키지 없이 Node.js만으로 실행되는 검증용 API입니다.

```bash
node server.js
```

- 웹 프로토타입: http://localhost:4100
- 상태 확인: http://localhost:4100/api/health
- 장소 API: /api/places
- 컬렉션 API: /api/collections
- 공유 컬렉션: /api/shared/:shareToken

테스트:

```bash
node test-api.js
```

현재 JSON 파일 저장 방식은 기능 검증용입니다. 정식 개발에서는 PostgreSQL/PostGIS와 인증, 오브젝트 스토리지로 교체합니다.
