# syntax=docker/dockerfile:1
# LAN 송신 프록시(폴백) — 공유 프록시(127.0.0.1:3128)가 없거나 유휴 한도가 부족할 때 쓴다.
# 소스는 이미지에 COPY 한다(바인드 마운트 금지) — 호스트 경로가 사라져도 기동해야 한다.
FROM node:24-alpine

WORKDIR /srv
COPY docker/lan-proxy/proxy.js /srv/proxy.js

# 기본값의 단일 출처는 proxy.js 다. 여기에 ENV 를 두면 코드 기본값을 조용히 덮어
# `/healthz` 는 ok 인데 값만 틀린 상태가 된다(공유 프록시에서 실제로 발생했다).
# 덮으려면 compose environment 또는 `docker run -e` 로 명시할 것.

USER node
EXPOSE 3129
CMD ["node", "/srv/proxy.js"]
