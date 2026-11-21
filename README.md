# VLTV

VLTV 是一个 VALORANT 比赛归档和数据分析站。它能从回放生成逐回合战报，并在网页上展示选手表现、战队战绩和赛事赛程。

## Quick start

安装 Docker Engine 和 Docker Compose v2（Docker Desktop 已包含两者）。首次构建需要联网下载镜像和依赖。已有仓库时，直接在包含 `compose.yaml` 的 `vltv` 目录操作。

```sh
git clone https://github.com/MMRyanSheep/vltv.git
cd vltv
cp .env.example .env
```

在 PowerShell 中，用 `Copy-Item .env.example .env` 复制配置文件。在 `.env` 中设置数据库密码 `VLTV_DB_PASSWORD`、管理员账号 `VLTV_ADMIN_USER` 和管理员密码 `VLTV_ADMIN_PASSWORD`。密码包含 `$` 时，用单引号包裹。

```sh
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

首次启动会自动初始化数据库。用 `.env` 中的管理员账号登录，在「导入比赛」中上传 `.vrf` 回放或同一场比赛的 JSON 报告。也可以选择包含 `json1.json` 和 `rounds/` 的单场导出目录。[战绩站](http://127.0.0.1:8080) · [管理后台](http://127.0.0.1:8080/admin)

镜像内置 SwingScore 模型和应用国服 13.10 补丁的 `vrfkit`。已有多场 JSON 报告时，可将目录复制到 API 容器并批量导入。

```sh
docker compose cp ./reports api:/tmp/vltv-reports
docker compose exec api python scripts/import-reports.py /tmp/vltv-reports
```

默认站点地址是 `127.0.0.1:8080`，可在 `.env` 中用 `VLTV_WEB_BIND` 和 `VLTV_WEB_PORT` 调整。通过 HTTPS 反向代理对外提供服务时，将上游指向该地址，转发原始 `Host` 和协议，并允许至少 128 MiB 的请求体和 450 秒的上游响应时间。比赛、赛事配置和自定义图片保存在 PostgreSQL 数据卷 `vltv-deploy_postgres-data` 中，执行 `docker compose down` 或重建镜像后仍可使用。

## Features

- **回放导入与导出**。管理后台可批量导入文件夹中的 `.vrf` 回放，单个回放最大 128 MiB。Rust CLI 可将 `.vrf` 或 `vrfkit` 导出的 Parquet 转为对局摘要、击杀快照和完整回合时间线。
- **比赛和选手数据**。查看记分板、逐回合事件、选手战绩和特工表现。SwingScore 衡量事件对回合胜率的影响，VLTV Rating 综合击杀、伤害、存活、KAST、多杀和回合影响。
- **赛事与战队**。浏览赛事赛程、系列赛比分和地图结果。战队主页汇总近期比赛、地图表现和赛事名次。
- **管理后台**。维护赛事、战队和对阵，关联已归档的地图回放，编辑选手与地图资料，并发布每周最佳选手。

## Contributions

欢迎提交 Issue 或 Pull Request。报告问题时，请附上复现步骤、预期结果和实际结果。涉及回放解析时，请注明客户端地区和版本，并使用可以公开分享的样例。[Issues](https://github.com/MMRyanSheep/vltv/issues) · [Pull Requests](https://github.com/MMRyanSheep/vltv/pulls)

回放解析与导出位于 `src/`，Axum API、数据库迁移及统计计算位于 `server/`，SwingScore 的训练脚本位于 `training/`，Next.js 前端位于 `web/`。提交前可在仓库根目录运行与改动对应的检查。Docker 镜像使用 Node.js 24 和 Python 3.12，Rust 使用支持 2024 edition 的稳定版。

```sh
cargo test --locked
cargo test --locked --manifest-path server/Cargo.toml
python -m pip install -r server/requirements.txt
python -m unittest discover -s server -p test_calculate_report.py
npm ci --prefix web
npm run check --prefix web
```

## License

VLTV 源代码采用 MIT 许可证。随项目提供的第三方资产适用各自的许可证。[MIT 许可证](LICENSE) · [字体许可证](web/public/fonts/OFL-1.1.txt)
