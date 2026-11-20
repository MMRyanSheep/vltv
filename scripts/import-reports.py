"""Import existing VLTV reports through the local archive API."""

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "training"))
from build_dataset import iter_matches


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, nargs="?", default=ROOT / "exampleReport")
    parser.add_argument("--api", default="http://127.0.0.1:3101")
    args = parser.parse_args()
    username = os.environ.get("VLTV_ADMIN_USER")
    password = os.environ.get("VLTV_ADMIN_PASSWORD")
    if not username or not password:
        parser.error("Set VLTV_ADMIN_USER and VLTV_ADMIN_PASSWORD for the archive API.")
    api = args.api.rstrip("/")
    count = 0
    try:
        login = Request(
            api + "/admin/session",
            data=json.dumps({"username": username, "password": password}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(login, timeout=8) as response:
                token = json.load(response)["token"]
        except HTTPError as error:
            parser.exit(1, f"Admin login failed: HTTP {error.code}: {error.read().decode('utf-8')}\n")
        for summary, rounds in iter_matches(args.source):
            match_id = summary["match_id"]
            report = {
                "summary": summary,
                "timeline": {"match_id": match_id, "rounds": list(rounds)},
            }
            request = Request(
                api + "/imports",
                data=json.dumps(report).encode("utf-8"),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
                method="POST",
            )
            try:
                with urlopen(request, timeout=60) as response:
                    receipt = json.load(response)
            except HTTPError as error:
                parser.exit(1, f"{match_id}: HTTP {error.code}: {error.read().decode('utf-8')}\n")
            print(f"{receipt['match_id']}: {receipt['round_count']} rounds")
            count += 1
    except (OSError, URLError, ValueError, KeyError) as error:
        parser.exit(1, f"Import stopped after {count} matches: {error}\n")
    print(f"Imported {count} matches")


if __name__ == "__main__":
    main()
