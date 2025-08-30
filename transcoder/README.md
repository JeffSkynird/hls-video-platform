# Transcoder (HLS)

HLS transcoding service written in Rust. It consumes upload events from RabbitMQ, downloads the source file from MinIO/S3, generates HLS variants with FFmpeg, and publishes the result to a VOD bucket, emitting a `video.ready` event when finished.

## Requirements
- Docker 24+ and Docker Compose v2 (the `docker compose` plugin).
- x86_64 or arm64 CPU with FFmpeg support on Debian.
- Access to a RabbitMQ and a MinIO/S3 reachable from the same Docker network.

## Start with Docker Compose
1) Prepare environment variables:

```bash
cp .env.example .env
```

2) Build and start the service:

```bash
docker compose build
docker compose up -d
```


## Connect to the backend (MinIO and RabbitMQ)
To connect it to the backend (which uploads videos and publishes `video.uploaded`) running in another stack, attach their containers to the same external network so the transcoder can resolve them by name:

```bash
docker network connect vidstack_net vidstack-minio
docker network connect vidstack_net vidstack-rabbitmq
```

Make sure the container names (`vidstack-minio` and `vidstack-rabbitmq`) match those used by your backend, or adjust `.env` (`AMQP_URL`, `S3_ENDPOINT`) to point to the actual names.

## Workflow
- Listens to `AMQP_QUEUE` bound to `AMQP_EXCHANGE` with routing key `AMQP_UPLOADS_RK`.
- Downloads `inputKey` from `S3_BUCKET_UPLOADS` to `WORKDIR`.
- Generates HLS (3 qualities) plus `master.m3u8` and `thumb.jpg` with FFmpeg.
- Uploads the resulting tree to `S3_BUCKET_VOD` under `HLS_PREFIX/{videoId}/`.
- Publishes `video.ready` with `outputPrefix` and `thumbKey`.

## Cleanup
To stop and remove the stack's containers/volumes:

```bash
docker compose down -v
```
