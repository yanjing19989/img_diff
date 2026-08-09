#!/usr/bin/env python3
"""Serve the image comparison frontend with two preselected local images."""

from __future__ import annotations

import argparse
import json
import mimetypes
import shutil
import subprocess
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


PROJECT_ROOT = Path("E:/code/diff2")
DIST_DIR = PROJECT_ROOT / "dist"
MODES = ("split", "fade", "slider", "highlight", "subtract", "details")
SUPPORTED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
IMAGE_ROUTES = {
    "/__image_diff__/left": "left",
    "/__image_diff__/right": "right",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="在浏览器中使用项目前端对比两张本地图片。",
    )
    parser.add_argument("left", type=Path, help="原始图片路径")
    parser.add_argument("right", type=Path, help="修改图片路径")
    parser.add_argument(
        "-m",
        "--mode",
        choices=MODES,
        default="split",
        help="对比模式（默认：split）",
    )
    parser.add_argument("--host", default="127.0.0.1", help="监听地址（默认：127.0.0.1）")
    parser.add_argument("--port", type=int, default=8000, help="监听端口（默认：8000）")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    return parser.parse_args()


def validate_image(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise ValueError(f"{label}不存在或不是文件：{resolved}")
    if resolved.suffix.lower() not in SUPPORTED_SUFFIXES:
        formats = "、".join(sorted(suffix.removeprefix(".").upper() for suffix in SUPPORTED_SUFFIXES))
        raise ValueError(f"{label}格式不受支持（支持 {formats}）：{resolved}")
    return resolved


def frontend_needs_build() -> bool:
    output = DIST_DIR / "index.html"
    if not output.is_file():
        return True

    inputs = [
        PROJECT_ROOT / "index.html",
        PROJECT_ROOT / "package.json",
        PROJECT_ROOT / "package-lock.json",
        PROJECT_ROOT / "tsconfig.json",
        PROJECT_ROOT / "vite.config.ts",
        *list((PROJECT_ROOT / "src").rglob("*")),
    ]
    output_time = output.stat().st_mtime
    return any(path.is_file() and path.stat().st_mtime > output_time for path in inputs)


def ensure_frontend() -> None:
    if not frontend_needs_build():
        return

    npm = shutil.which("npm")
    if npm is None:
        raise RuntimeError("前端尚未构建，且未找到 npm；请先安装 Node.js 并运行 npm install")

    print("正在构建前端……", flush=True)
    try:
        subprocess.run([npm, "run", "build"], cwd=PROJECT_ROOT, check=True)
    except subprocess.CalledProcessError as error:
        raise RuntimeError("前端构建失败，请确认已运行 npm install") from error


def make_handler(images: dict[str, Path], mode: str):
    config = {
        "left": {"name": images["left"].name, "url": "/__image_diff__/left"},
        "right": {"name": images["right"].name, "url": "/__image_diff__/right"},
        "mode": mode,
    }

    class CompareRequestHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(DIST_DIR), **kwargs)

        def do_GET(self) -> None:
            route = urlsplit(self.path).path
            if route == "/__image_diff__/config":
                self.send_json(config)
                return
            if route in IMAGE_ROUTES:
                self.send_image(images[IMAGE_ROUTES[route]])
                return
            super().do_GET()

        def send_json(self, value: object) -> None:
            payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

        def send_image(self, path: Path) -> None:
            try:
                size = path.stat().st_size
                stream = path.open("rb")
            except OSError:
                self.send_error(404, "Image is no longer available")
                return

            with stream:
                content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(size))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                shutil.copyfileobj(stream, self.wfile)

    return CompareRequestHandler


def main() -> int:
    args = parse_args()
    if not 0 <= args.port <= 65535:
        print("错误：端口必须在 0 到 65535 之间", file=sys.stderr)
        return 2

    try:
        images = {
            "left": validate_image(args.left, "原始图片"),
            "right": validate_image(args.right, "修改图片"),
        }
        ensure_frontend()
        server = ThreadingHTTPServer((args.host, args.port), make_handler(images, args.mode))
    except (OSError, RuntimeError, ValueError) as error:
        print(f"错误：{error}", file=sys.stderr)
        return 1

    actual_port = server.server_address[1]
    browser_host = "127.0.0.1" if args.host in {"0.0.0.0", "::"} else args.host
    url = f"http://{browser_host}:{actual_port}/?autoload=1"
    print(f"对比服务已启动：{url}")
    print("按 Ctrl+C 停止服务。")

    if not args.no_browser:
        threading.Timer(0.2, webbrowser.open, args=(url,)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
