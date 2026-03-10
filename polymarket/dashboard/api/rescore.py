"""
Vercel Python serverless function — thin proxy for rescore jobs.

No scoring logic here. Just reads from Supabase and creates jobs
that the Railway scheduler picks up and processes.

GET  /api/rescore              -> list wallets
GET  /api/rescore?job_id=N     -> check job progress
POST /api/rescore {"action":"rescore_all"}  -> create full rescore job
POST /api/rescore {"address":"0x..."}       -> create single wallet job
"""
import json
import os
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import requests


def _clean_env(name: str) -> str:
    """Strip curly/smart quotes and whitespace that iPad paste may introduce."""
    val = os.environ.get(name, "")
    return val.strip().strip("\"'\u201c\u201d\u2018\u2019").strip()


SUPABASE_URL = _clean_env("SUPABASE_URL")
SUPABASE_KEY = _clean_env("SUPABASE_SERVICE_KEY")

SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

ANON_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}


def sb_query(table, params=""):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}?{params}",
        headers=ANON_HEADERS,
        timeout=10,
    )
    return r.json() if r.ok else []


def sb_insert(table, data):
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**SB_HEADERS, "Prefer": "return=representation"},
        json=data,
        timeout=10,
    )
    if r.ok:
        rows = r.json()
        return rows[0] if isinstance(rows, list) and rows else rows
    return None


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if not SUPABASE_URL or not SUPABASE_KEY:
            self._json(500, {"error": "Missing Supabase env vars"})
            return

        # Check for job_id query param
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        job_id = qs.get("job_id", [None])[0]

        if job_id:
            # Return job status
            jobs = sb_query("rescore_jobs", f"id=eq.{job_id}&select=*")
            if jobs:
                self._json(200, {"job": jobs[0]})
            else:
                self._json(404, {"error": "Job not found"})
            return

        # Default: return wallet list
        wallets = sb_query("wallets", "select=address,label&order=created_at.desc&limit=500")
        self._json(200, {"wallets": wallets})

    def do_POST(self):
        if not SUPABASE_URL or not SUPABASE_KEY:
            self._json(500, {"error": "Missing Supabase env vars"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except Exception:
            self._json(400, {"error": "Invalid JSON"})
            return

        action = body.get("action", "")
        address = body.get("address", "").strip().lower()

        if action == "rescore_all":
            # Create a full rescore job
            job = sb_insert("rescore_jobs", {
                "job_type": "full",
                "status": "pending",
            })
            if job:
                self._json(200, {"ok": True, "job_id": job.get("id")})
            else:
                self._json(500, {"ok": False, "error": "Failed to create job"})

        elif address and address.startswith("0x"):
            # Create a single-wallet rescore job
            job = sb_insert("rescore_jobs", {
                "job_type": "single",
                "address": address,
                "status": "pending",
                "total": 1,
            })
            if job:
                self._json(200, {"ok": True, "job_id": job.get("id")})
            else:
                self._json(500, {"ok": False, "error": "Failed to create job"})

        else:
            self._json(400, {"error": "Provide 'action':'rescore_all' or 'address':'0x...'"})
