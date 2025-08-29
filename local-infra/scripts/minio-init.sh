#!/usr/bin/env bash
# Use this script to initialize MinIO with required buckets without using the docker-compose command directly.
set -euo pipefail

: "${MINIO_ROOT_USER:?}"
: "${MINIO_ROOT_PASSWORD:?}"
: "${S3_BUCKET_UPLOADS:=uploads}"
: "${S3_BUCKET_VOD:=vod}"

echo "Waiting for MinIO..."
until /usr/bin/mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  sleep 2
done

/usr/bin/mc mb -p "local/${S3_BUCKET_UPLOADS}" || true
/usr/bin/mc mb -p "local/${S3_BUCKET_VOD}"     || true
/usr/bin/mc ls local || true
