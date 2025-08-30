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

## 4) Probar HLS y flujo API

### 4.a) Flujo completo por API: subir → transcodificar → publicar → listar

1) Crear/ingresar usuario (obtiene token/sesión)
```
curl -X POST http://localhost:3000/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"demo@example.com"}'
```

2) Reservar video (crear metadatos)
```
curl -X POST http://localhost:3000/v1/videos \
  -H 'content-type: application/json' \
  -d '{"title":"Mi primer video","tags":["demo","test"]}'
```

3) Solicitar URL firmada para subir
```
curl -X POST http://localhost:3000/v1/uploads/signed-url \
  -H 'content-type: application/json' \
  -d '{"videoId":"<VIDEO_ID>","contentType":"video/mp4","fileSize":10485760}'
```
- Reemplaza `<VIDEO_ID>` por el `id` del video creado en el paso 2.
- Guarda la respuesta JSON.

4) Subir el archivo firmado a MinIO (bucket `uploads`)
```
cd local-infra/.signed-urls
curl -X POST "http://localhost:9000/uploads" \
  $(jq -r '.fields | to_entries[] | "-F \(.key)=\(.value)"' resp.json) \
  -F "file=@sample.mp4"
```
- El archivo resp.json es donde esta el json generado en el paso previo.
- el archivo sample.mp4 es el video a transcodificar.

5) Publicar el video (hacerlo público)
```
curl -X POST http://localhost:3000/v1/videos/<VIDEO_ID>/publish \
  -H 'content-type: application/json' \
  -d '{"visibility":"public"}'
```

6) Listar videos públicos y listos (paginado)
```
curl 'http://localhost:3000/v1/videos?status=ready&visibility=public&page=1&pageSize=10'
```
- Una vez el video esté transcodificado, este endpoint incluye `hlsUrl` que apunta al `master.m3u8`.

7) Buscar en el índice (MeiliSearch)
```
curl 'http://localhost:3000/v1/search?q=demo&page=1&pageSize=5'
```

8) Dar permisos de lectura al bucket VOD para acceder al `hlsUrl`
```
docker compose -f local-infra/infra/docker-compose.yml run --rm --entrypoint sh minio-mc -lc \
  'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1 && \
   mc anonymous set download local/vod && \
   mc anonymous get local/vod'
```
- Esto habilita acceso anónimo de solo lectura al bucket `vod` donde se escriben las rendiciones HLS.
- Se debe ejecutar en la raiz.
