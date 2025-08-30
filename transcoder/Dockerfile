# ---------- Builder ----------
FROM rust:1.86-slim AS builder
WORKDIR /app
# Install deps to compile crates with OpenSSL
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
# Create dummy src for deps cache
RUN mkdir src && echo "fn main(){}" > src/main.rs
RUN cargo build --release && rm -rf target/release/deps/transcoder*
# Copy code
COPY src ./src
RUN cargo build --release

# ---------- Runtime ----------
FROM debian:bookworm-slim
# FFmpeg + utils
RUN apt-get update && apt-get install -y ffmpeg ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/transcoder /usr/local/bin/transcoder
ENV RUST_LOG=info METRICS_PORT=9102 WORKDIR=/work
RUN mkdir -p ${WORKDIR}
EXPOSE 9102
ENTRYPOINT ["/usr/local/bin/transcoder"]
