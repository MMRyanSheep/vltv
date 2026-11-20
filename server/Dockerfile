FROM rust:1-bookworm AS rust-build
WORKDIR /opt/vltv

COPY patches/vrfkit-china-13.10.patch /tmp/vrfkit-china-13.10.patch
# Match the revision used by scripts/build-vrfkit.ps1.
RUN git init /tmp/vrfkit \
    && git -C /tmp/vrfkit fetch --depth 1 https://github.com/yakisoba0728/vrfkit 9ece4ab84dee62cbf8bf34b7996d2efb0593f9c9 \
    && git -C /tmp/vrfkit checkout --detach FETCH_HEAD \
    && git -C /tmp/vrfkit apply /tmp/vrfkit-china-13.10.patch \
    && cargo build --locked --release --manifest-path /tmp/vrfkit/Cargo.toml -p vrfkit \
    && strip /tmp/vrfkit/target/release/vrfkit

COPY Cargo.toml Cargo.lock ./
COPY src/ ./src/
COPY server/Cargo.toml server/Cargo.lock ./server/
COPY server/migrations/ ./server/migrations/
COPY server/src/ ./server/src/
RUN cargo build --locked --release --manifest-path server/Cargo.toml --bin vltv-api

FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VLTV_API_ADDR=0.0.0.0:3101 \
    VRFKIT=/usr/local/bin/vrfkit
WORKDIR /opt/vltv
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgcc-s1 libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system vltv \
    && useradd --system --gid vltv --no-create-home vltv

COPY server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir --only-binary=:all: -r server/requirements.txt

COPY --from=rust-build /tmp/vrfkit/target/release/vrfkit /usr/local/bin/vrfkit
COPY --from=rust-build /opt/vltv/server/target/release/vltv-api /usr/local/bin/vltv-api
COPY server/calculate_report.py server/calculate_rating.py ./server/
COPY training/build_dataset.py training/calculate_swing.py training/training.py training/round_win_model.txt ./training/
COPY scripts/import-reports.py ./scripts/

USER vltv
RUN python -c "import sys; sys.path.insert(0, 'server'); from calculate_report import lgb; lgb.Booster(model_file='training/round_win_model.txt')"
EXPOSE 3101
CMD ["vltv-api"]
