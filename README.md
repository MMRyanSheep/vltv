# VLTV Docker 部署

在安装了 Docker Engine 和 Docker Compose v2 的机器上，将整个 `vltv` 目录复制到目标服务器。从该目录运行下列命令。构建需要访问 Docker Hub、GitHub、crates.io、npm、PyPI 和 Debian 软件源。

```sh
cp .env.example .env
```

PowerShell 对应命令为 `Copy-Item .env.example .env`。在 `.env` 中填写独立的数据库密码 `VLTV_DB_PASSWORD`、管理员账号 `VLTV_ADMIN_USER` 和管理员密码 `VLTV_ADMIN_PASSWORD`。密码包含美元符号时，可在 `.env` 中用单引号包裹。

```sh
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

默认从部署主机访问 [战绩站](http://127.0.0.1:8080) 和 [管理后台](http://127.0.0.1:8080/admin)。`VLTV_WEB_PORT` 可以调整宿主机端口。通过 HTTPS 反向代理提供公网访问时，可将上游配置为 `127.0.0.1:8080`，保留请求的 Host 和原协议，并允许至少 128 MiB 的请求体和 450 秒的上游响应时间，以支持回放上传。需要直接从局域网访问时，将 `VLTV_WEB_BIND` 设为部署主机的局域网 IP 或 `0.0.0.0`。PostgreSQL 与 Axum 通过 Compose 网络通信。

## 数据与导入

Docker 使用独立的 `vltv-deploy` Compose 项目和 `vltv-deploy_postgres-data` 数据卷。首次启动时，Axum 在空库中执行迁移。比赛、赛事配置和自定义图片存放在该卷里，执行 `docker compose down` 或重建镜像后仍保留。

部署镜像内置 SwingScore 模型和应用国服 13.10 补丁的 Linux 版 `vrfkit`。登录管理后台后可以上传原始 `.vrf` 或 JSON 报告。要批量导入，先将报告目录复制到 API 容器，再运行脚本。

```sh
docker compose cp ./reports api:/tmp/vltv-reports
docker compose exec api python scripts/import-reports.py /tmp/vltv-reports
```

本地 Windows 服务仍从上一级项目目录运行。本地 PostgreSQL、回放、报告和训练数据均保留在原位置。部署首次启动时使用自己的空库。
