use std::{env, path::{Path, PathBuf}, process::Stdio, time::Duration};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::{fs, io::AsyncWriteExt, process::Command};
use tracing::{error, info, instrument};
use lapin::{options::*, types::FieldTable, Channel, Connection, ConnectionProperties};
use aws_config::Region;
use aws_sdk_s3 as s3;
use aws_sdk_s3::primitives::ByteStream;
use futures_lite::stream::StreamExt;
use walkdir::WalkDir;
use prometheus::{Encoder, TextEncoder, IntCounter, Histogram, HistogramOpts, IntCounterVec};
use axum::{routing::get, Router, response::IntoResponse};
use url::Url;

#[derive(Debug, Deserialize)]
struct UploadEvt { videoId: String, inputKey: String, ownerId: String }
#[derive(Debug, Serialize)]
struct ReadyEvt { videoId: String, outputPrefix: String, thumbKey: String, durationSec: f64 }

struct Cfg {
    amqp_url: String,
    amqp_exchange: String,
    amqp_uploaded_rk: String,
    amqp_ready_rk: String,
    amqp_queue: String,
    s3_endpoint: String,
    s3_bucket_uploads: String,
    s3_bucket_vod: String,
    region: String,
    hls_prefix: String,
    seg_secs: u32,
    workdir: PathBuf,
    metrics_port: u16,
}

fn cfg() -> Cfg {
    Cfg {
        amqp_url: env::var("AMQP_URL").or_else(|_| env::var("RABBITMQ_URL")).expect("AMQP_URL or RABBITMQ_URL"),
        amqp_exchange: env::var("AMQP_EXCHANGE").unwrap_or_else(|_| "domain".into()),
        amqp_uploaded_rk: env::var("AMQP_UPLOADS_RK").unwrap_or_else(|_| "video.uploaded".into()),
        amqp_ready_rk: env::var("AMQP_READY_RK").unwrap_or_else(|_| "video.ready".into()),
        amqp_queue: env::var("AMQP_QUEUE").unwrap_or_else(|_| "q.transcoder.uploaded".into()),
        s3_endpoint: env::var("S3_ENDPOINT").expect("S3_ENDPOINT"),
        s3_bucket_uploads: env::var("S3_BUCKET_UPLOADS").unwrap_or_else(|_| "uploads".into()),
        s3_bucket_vod: env::var("S3_BUCKET_VOD").unwrap_or_else(|_| "vod".into()),
        region: env::var("AWS_REGION").unwrap_or_else(|_| "us-east-1".into()),
        hls_prefix: env::var("HLS_PREFIX").unwrap_or_else(|_| "hls".into()),
        seg_secs: env::var("SEGMENT_SECONDS").ok().and_then(|v| v.parse().ok()).unwrap_or(6),
        workdir: PathBuf::from(env::var("WORKDIR").unwrap_or_else(|_| "/work".into())),
        metrics_port: env::var("METRICS_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(9102),
    }
}

// ---------------- Metrics TODO -----------------
lazy_static::lazy_static! {
    static ref M_GOT: IntCounter = IntCounter::new("transcoder_events_total", "Eventos recibidos").unwrap();
    static ref M_OK: IntCounter = IntCounter::new("transcoder_success_total", "Eventos procesados ok").unwrap();
    static ref M_ERR: IntCounter = IntCounter::new("transcoder_error_total", "Errores de proceso").unwrap();
    static ref H_DURATION: Histogram = Histogram::with_opts(HistogramOpts::new("transcoder_duration_seconds", "Duración total por video")).unwrap();
    static ref M_FF: IntCounterVec = IntCounterVec::new(prometheus::opts!("transcoder_ffmpeg_runs", "FFmpeg runs"), &["variant"]).unwrap();
}

async fn metrics_app() -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/metrics", get(|| async move {
            let metric_families = prometheus::gather();
            let mut buffer = Vec::new();
            TextEncoder::new().encode(&metric_families, &mut buffer).unwrap();
            String::from_utf8(buffer).unwrap().into_response()
        }))
}

fn parse_host_port(url_str: &str) -> Result<(String, u16)> {
    let url = Url::parse(url_str)?;
    let host = url.host_str().ok_or_else(|| anyhow::anyhow!("missing host"))?.to_string();
    let port = url.port_or_known_default().ok_or_else(|| anyhow::anyhow!("missing port"))?;
    Ok((host, port))
}

#[instrument(skip_all)]
async fn wait_dns(host: &str, port: u16, max_secs: u64) -> Result<()> {
    let mut waited = 0u64;
    loop {
        match tokio::net::lookup_host((host, port)).await {
            Ok(_) => {
                info!(host, port, "DNS ok");
                return Ok(());
            }
            Err(e) => {
                if waited >= max_secs { return Err(e.into()); }
                if waited % 5 == 0 { info!(host, port, waited, "Esperando DNS..."); }
                tokio::time::sleep(Duration::from_secs(1)).await;
                waited += 1;
            }
        }
    }
}

#[instrument(skip_all)]
async fn connect_amqp_with_retry(url: &str, max_secs: u64) -> Result<Connection> {
    let mut waited = 0u64;
    loop {
        match Connection::connect(url, ConnectionProperties::default()).await {
            Ok(c) => return Ok(c),
            Err(e) => {
                if waited >= max_secs { return Err(e.into()); }
                if waited % 5 == 0 { info!(error = ?e, waited, "AMQP: reintento de conexión"); }
                tokio::time::sleep(Duration::from_secs(1)).await;
                waited += 1;
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();
    let cfg = cfg();

    // Metrics server
    let app = metrics_app().await;
    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.metrics_port)).await.unwrap();
        axum::serve(listener, app.into_make_service()).await.unwrap();
    });

    // Wait for MinIO DNS/port
    if let Ok((host, port)) = parse_host_port(&cfg.s3_endpoint) {
        wait_dns(&host, port, 60).await?;
    }

    // S3 client (MinIO)
    let shared = aws_config::from_env()
        .region(Region::new(cfg.region.clone()))
        .endpoint_url(cfg.s3_endpoint.clone())
        .load()
        .await;
    let s3_conf = s3::config::Builder::from(&shared).force_path_style(true).build();
    let s3 = s3::Client::from_conf(s3_conf);

    // Waait for RabbitMQ DNS/port
    if let Ok((host, port)) = parse_host_port(&cfg.amqp_url) {
        wait_dns(&host, port, 60).await?;
    }

    // AMQP (with retry)
    let conn = connect_amqp_with_retry(&cfg.amqp_url, 60).await?;
    let ch = conn.create_channel().await?;
    ch.queue_declare(&cfg.amqp_queue, QueueDeclareOptions { durable: true, ..Default::default() }, FieldTable::default()).await?;
    ch.queue_bind(&cfg.amqp_queue, &cfg.amqp_exchange, &cfg.amqp_uploaded_rk, QueueBindOptions::default(), FieldTable::default()).await?;
    ch.basic_qos(1, BasicQosOptions::default()).await?;

    let mut consumer = ch.basic_consume(&cfg.amqp_queue, "transcoder", BasicConsumeOptions::default(), FieldTable::default()).await?;
    info!("Transcoder waiting for events in {}", cfg.amqp_queue);

    while let Some(delivery) = consumer.next().await {
        M_GOT.inc();
        match delivery {
            Ok(deliv) => {
                let data = deliv.data.clone();
                let ch_clone = ch.clone();
                let s3c = s3.clone();
                let cfgc = cfg_clone(&cfg);
                tokio::spawn(async move {
                    let _timer = H_DURATION.start_timer();
                    let res = process_msg(&cfgc, &s3c, &ch_clone, &data).await;
                    match res {
                        Ok(_) => {
                            if let Err(e) = deliv.ack(lapin::options::BasicAckOptions::default()).await {
                                error!(?e, "Ack failed");
                            }
                            M_OK.inc();
                        }
                        Err(e) => {
                            if is_nosuchkey(&e) {
                                error!(?e, "Key not found - discarting");
                                if let Err(e2) = deliv.ack(lapin::options::BasicAckOptions::default()).await {
                                    error!(?e2, "Ack failed");
                                }
                            } else {
                                error!(?e, "Error procesing - requeue");
                                if let Err(e2) = deliv.nack(lapin::options::BasicNackOptions { requeue: true, multiple: false }).await {
                                    error!(?e2, "Nack failed");
                                }
                            }
                            M_ERR.inc();
                        }
                    }
                });
            }
            Err(e) => { error!(error=?e, "Error en delivery"); }
        }
    }

    Ok(())
}

fn cfg_clone(c: &Cfg) -> Cfg { Cfg { amqp_url: c.amqp_url.clone(), amqp_exchange: c.amqp_exchange.clone(), amqp_uploaded_rk: c.amqp_uploaded_rk.clone(), amqp_ready_rk: c.amqp_ready_rk.clone(), amqp_queue: c.amqp_queue.clone(), s3_endpoint: c.s3_endpoint.clone(), s3_bucket_uploads: c.s3_bucket_uploads.clone(), s3_bucket_vod: c.s3_bucket_vod.clone(), region: c.region.clone(), hls_prefix: c.hls_prefix.clone(), seg_secs: c.seg_secs, workdir: c.workdir.clone(), metrics_port: c.metrics_port } }

#[instrument(skip(cfg, s3, ch, body))]
async fn process_msg(cfg: &Cfg, s3: &s3::Client, ch: &Channel, body: &[u8]) -> Result<()> {
    let evt: UploadEvt = serde_json::from_slice(body).context("json video.uploaded")?;
    let out_prefix = format!("{}/{}/{}", cfg.hls_prefix, evt.videoId, ""); // hls/{videoId}/
    let master_key = format!("{}/master.m3u8", out_prefix.trim_end_matches('/'));

    // Idempotency: if exists master.m3u8, skip
    if head_ok(s3, &cfg.s3_bucket_vod, &master_key).await {
        info!(videoId=%evt.videoId, "Master already exists; skip");
        return Ok(());
    }

    // Download input in /work/{videoId}/input.mp4
    let work = cfg.workdir.join(&evt.videoId);
    fs::create_dir_all(&work).await.ok();
    let input_path = work.join("input.mp4");

    let bucket_in = &cfg.s3_bucket_uploads; // "uploads"
    let final_key = evt.inputKey.trim_start_matches('/').to_string();
    info!(bucket=%bucket_in, key=%final_key, "Descargando input");

    download_object(s3, &bucket_in, &final_key, &input_path).await
        .with_context(|| format!("descargando {}", &final_key))?;

    // Execute ffmpeg → /work/{videoId}/out
    let out_dir = work.join("out");
    fs::create_dir_all(&out_dir).await?;
    let duration = transcode_hls(&input_path, &out_dir, cfg.seg_secs).await?;
    info!(videoId = %evt.videoId, duration_sec = duration, out = %out_dir.display(),
        "HLS generated (prog.m3u8 + segments)");
    if fs::metadata(out_dir.join("master.m3u8")).await.is_ok() {
        info!(videoId = %evt.videoId, "master.m3u8 OK in {:?}", out_dir);
    } else {
        error!(videoId = %evt.videoId, "master.m3u8 NOT FOUND in {:?}", out_dir);
    }
    // Thumbnail
    let thumb_path = work.join("thumb.jpg");
    gen_thumb(&input_path, &thumb_path).await?;

    // Upload all to S3 in vod/{out_prefix}
    upload_tree(s3, &cfg.s3_bucket_vod, &out_prefix, &out_dir).await?;
    info!(bucket = %cfg.s3_bucket_vod, prefix = %out_prefix,
    "Upload HLS completed to S3 (out_0/1/2 + master exists)");
    // Upload master.m3u8 (ffmpeg generate this in out_dir)
    upload_file(s3, &cfg.s3_bucket_vod, &format!("{}thumb.jpg", out_prefix), &thumb_path, Some("image/jpeg")).await?;
    info!(thumb_key = %format!("{}thumb.jpg", out_prefix), "Thumbnail subido");

    // Publish video.ready
    let ready = ReadyEvt { videoId: evt.videoId, outputPrefix: out_prefix.clone(), thumbKey: format!("{}thumb.jpg", out_prefix), durationSec: duration };
    let payload = serde_json::to_vec(&ready)?;
    ch.basic_publish(&cfg.amqp_exchange, &cfg.amqp_ready_rk, BasicPublishOptions::default(), &payload, lapin::BasicProperties::default()).await?.await?;

    // Cleanup
    let _ = fs::remove_dir_all(&work).await;

    info!("Event video.ready published");
    info!("Transcoding DONE ✅");

    Ok(())
}

async fn head_ok(s3: &s3::Client, bucket: &str, key: &str) -> bool {
    s3.head_object().bucket(bucket).key(key).send().await.is_ok()
}

async fn download_object(s3c: &s3::Client, bucket: &str, key: &str, to: &Path) -> Result<()> {
    let obj = s3c.get_object().bucket(bucket).key(key).send().await?;
    let mut reader = obj.body.into_async_read();
    let mut f = fs::File::create(to).await?;
    tokio::io::copy(&mut reader, &mut f).await?;
    Ok(())
}

async fn upload_tree(s3c: &s3::Client, bucket: &str, prefix: &str, dir: &Path) -> Result<()> {
    for entry in WalkDir::new(dir) {
        let e = entry?;
        if e.file_type().is_file() {
            let rel = e.path().strip_prefix(dir).unwrap();
            let key = format!("{}{}", prefix, rel.to_string_lossy().replace('\\', "/"));
            let ctype = match e.path().extension().and_then(|s| s.to_str()) { Some("m3u8") => Some("application/vnd.apple.mpegurl"), Some("ts") => Some("video/mp2t"), Some("mp4") => Some("video/mp4"), _ => None };
            upload_file(s3c, bucket, &key, e.path(), ctype).await?;
        }
    }
    Ok(())
}

async fn upload_file(s3c: &s3::Client, bucket: &str, key: &str, path: &Path, ctype: Option<&str>) -> Result<()> {
    let body = ByteStream::from_path(path).await?;
    let mut req = s3c.put_object().bucket(bucket).key(key).body(body);
    if let Some(ct) = ctype { req = req.content_type(ct); }
    req.send().await?;
    Ok(())
}

#[instrument]
async fn transcode_hls(input: &Path, out_dir: &Path, seg: u32) -> Result<f64> {
    // Read duration
    let dur = probe_duration(input).await.unwrap_or(0.0);
    for i in 0..=2 {
        tokio::fs::create_dir_all(out_dir.join(format!("out_{}", i))).await?;
    }
    // Out directory by variant: out_0, out_1, out_2
    let cmd = Command::new("ffmpeg")
        .current_dir(out_dir)
        .arg("-y").arg("-i").arg(input)
        .args(["-filter_complex",
            "[0:v]split=3[v1][v2][v3]; \
             [v1]scale=w=1920:h=1080:force_original_aspect_ratio=decrease:eval=frame:force_divisible_by=2[v1out]; \
             [v2]scale=w=1280:h=720:force_original_aspect_ratio=decrease:eval=frame:force_divisible_by=2[v2out]; \
             [v3]scale=w=854:h=480:force_original_aspect_ratio=decrease:eval=frame:force_divisible_by=2[v3out]"
        ])
        .args(["-map", "[v1out]", "-map", "0:a:0?", "-c:v:0", "libx264", "-b:v:0", "6000k", "-maxrate:v:0", "6420k", "-bufsize:v:0", "9000k", "-g", &format!("{}", seg*30), "-keyint_min", &format!("{}", seg*30), "-sc_threshold", "0", "-preset", "veryfast", "-c:a:0", "aac", "-b:a:0", "192k", "-ac", "2"])
        .args(["-map", "[v2out]", "-map", "0:a:0?", "-c:v:1", "libx264", "-b:v:1", "3000k", "-maxrate:v:1", "3210k", "-bufsize:v:1", "4500k", "-g", &format!("{}", seg*30), "-keyint_min", &format!("{}", seg*30), "-sc_threshold", "0", "-preset", "veryfast", "-c:a:1", "aac", "-b:a:1", "160k", "-ac", "2"])
        .args(["-map", "[v3out]", "-map", "0:a:0?", "-c:v:2", "libx264", "-b:v:2", "1500k", "-maxrate:v:2", "1605k", "-bufsize:v:2", "2250k", "-g", &format!("{}", seg*30), "-keyint_min", &format!("{}", seg*30), "-sc_threshold", "0", "-preset", "veryfast", "-c:a:2", "aac", "-b:a:2", "128k", "-ac", "2"])
        .args(["-f", "hls", "-hls_time", &seg.to_string(), "-hls_playlist_type", "vod", "-hls_flags", "independent_segments", "-hls_segment_filename", "out_%v/seg_%03d.ts", "-master_pl_name", "master.m3u8", "-var_stream_map", "v:0,a:0 v:1,a:1 v:2,a:2", "out_%v/prog.m3u8"])
        .stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn()?;

    let out = cmd.wait_with_output().await?;
    if !out.status.success() { return Err(anyhow::anyhow!(format!("ffmpeg failed: {}", String::from_utf8_lossy(&out.stderr)))); }
    M_FF.with_label_values(&["ladder"]).inc();
    Ok(dur)
}

async fn gen_thumb(input: &Path, out: &Path) -> Result<()> {
    let st = Command::new("ffmpeg")
        .args(["-y", "-ss", "3", "-i"]).arg(input)
        .args(["-frames:v", "1"]).arg(out)
        .stdout(Stdio::null()).stderr(Stdio::piped())
        .spawn()?;
    let outp = st.wait_with_output().await?;
    if !outp.status.success() { return Err(anyhow::anyhow!("thumb ffmpeg failed")); }
    M_FF.with_label_values(&["thumb"]).inc();
    Ok(())
}

async fn probe_duration(input: &Path) -> Result<f64> {
    let o = Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1"]).arg(input)
        .stdout(Stdio::piped())
        .output().await?;
    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
    Ok(s.parse::<f64>().unwrap_or(0.0))
}

fn is_nosuchkey(e: &anyhow::Error) -> bool {
    format!("{:?}", e).contains("NoSuchKey")
}