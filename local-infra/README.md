# Local Infra – Step 1

## Requirements
- Docker 24+ and Docker Compose v2

## 1) Prepare environment variables
```
cp .env.example .env
```

## 2) Start everything
```
cd infra &&
docker compose up -d --build
```

## 3) Verify
- Backend: `http://localhost:3000/health` → `{"status":"ok"}`
- Nginx: `http://localhost:8080/nginx-health` → `ok`
- RabbitMQ: `http://localhost:15672` (user/pass from .env)
- MinIO: `http://localhost:9001` (user/pass from .env)
- Meili: `http://localhost:7700/health` → `{"status":"available"}`
- ClickHouse: `curl http://localhost:8123/ping` → `Pong`

## 4) (Optional) Test static HLS
```
# Copy any HLS tree to the hls_renditions volume path inside the nginx container
# Example inside the container (to test paths):
# docker exec -it vidstack-nginx sh -lc 'mkdir -p /var/www/hls/demo && echo "#EXTM3U" > /var/www/hls/demo/master.m3u8'
# Then: http://localhost:8080/hls/demo/master.m3u8
```
