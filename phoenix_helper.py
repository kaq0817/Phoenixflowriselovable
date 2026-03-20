import difflib
import json
import logging
import os
import re
import smtplib
import subprocess
import sys
import threading
import uuid
import webbrowser
from dataclasses import asdict, dataclass
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from tkinter import (
    BOTH,
    BOTTOM,
    END,
    LEFT,
    RIGHT,
    SINGLE,
    TOP,
    X,
    Y,
    Button,
    Checkbutton,
    Entry,
    Frame,
    IntVar,
    Label,
    Listbox,
    Scrollbar,
    StringVar,
    Text,
    Tk,
    Toplevel,
    filedialog,
    messagebox,
    simpledialog,
)

APP_NAME = "Phoenix Helper"
APP_VERSION = "0.6.5"


def _format_exc(e: BaseException) -> str:
    return f"{type(e).__name__}: {e}"


def _log_unhandled(context: str, exc: BaseException):
    try:
        LOGGER.exception("Unhandled error (%s): %s", context, _format_exc(exc))
    except Exception:
        pass

def _pick_data_dir() -> Path:
    candidates: list[Path] = []

    try:
        candidates.append(Path.home() / ".phoenix_helper")
    except Exception:
        pass

    local_app_data = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA")
    if local_app_data:
        candidates.append(Path(local_app_data) / "PhoenixHelper")

    candidates.append(Path.cwd() / ".phoenix_helper")

    last_error: Exception | None = None
    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
        except Exception as e:
            last_error = e

    raise RuntimeError(f"Could not create a data directory. Last error: {last_error}")


DATA_DIR = _pick_data_dir()
TASKS_FILE = DATA_DIR / "tasks.json"
NOTES_FILE = DATA_DIR / "notes.json"
SETTINGS_FILE = DATA_DIR / "settings.json"
PROJECTS_FILE = DATA_DIR / "projects.json"


def _setup_logging() -> logging.Logger:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    log_path = DATA_DIR / "phoenix_helper.log"
    logger = logging.getLogger("phoenix_helper")
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    fh = logging.FileHandler(log_path, encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    return logger


LOGGER = _setup_logging()

DEFAULT_SETTINGS = {
    "user_name": "Friend",
    "smtp_server": "smtp.gmail.com",
    "smtp_port": 587,
    "smtp_email": "",
    "smtp_password": "",
    "openai_api_key": "",
    "openai_model": "gpt-5-mini",
    "shopify_admin_url": "",
    "default_project_folder": str(Path.home()),
    "support_mode": True,
    "domain_name": "ironphoenixflow.com",
    "current_host": "lovable.dev",
    "target_host": "",
    "registrar_url": "",
    "dns_provider_url": "",
    "hosting_dashboard_url": "",
    "active_project_id": "",
}

PROJECT_FIELDS = {
    "name",
    "repo_path",
    "domain_name",
    "current_host",
    "target_host",
    "pages_url",
    "worker_url",
    "supabase_url",
    "registrar_url",
    "dns_provider_url",
    "hosting_dashboard_url",
    "shopify_admin_url",
}

DEPENDENCY_FIELDS = {
    "name",
    "kind",
    "url",
    "owned",
    "status",
    "notes",
}

SCAN_IGNORE_DIR_NAMES = {
    ".git",
    ".hg",
    ".svn",
    ".next",
    "dist",
    "build",
    "out",
    "coverage",
    ".turbo",
    ".cache",
    ".phoenix_helper_backups",
    ".phoenix_helper",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
}

SCAN_FILE_EXTS = {
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".toml",
    ".json",
    ".env",
    ".md",
    ".yaml",
    ".yml",
    ".txt",
    ".html",
    ".css",
}

SCAN_IGNORE_FILE_NAMES = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "npm-shrinkwrap.json",
}


@dataclass
class ProjectScan:
    project_name: str
    repo_path: str
    framework: str
    found: list[str]
    lovable_hits: list[str]
    ai_hits: list[str]
    oauth_hits: list[str]
    shopify_hits: list[str]
    supabase_found: bool
    wrangler_found: bool
    summary: str


@dataclass
class MatchHit:
    path: str
    line_no: int
    line: str
    term: str
    category: str
    score: int
    reason: str


def _safe_read_text(path: Path, *, max_bytes: int = 1_500_000) -> str:
    try:
        if path.stat().st_size > max_bytes:
            return ""
        return path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def _walk_repo_files(repo_root: Path):
    stack = [repo_root]
    while stack:
        cur = stack.pop()
        try:
            for entry in cur.iterdir():
                name = entry.name
                if entry.is_dir():
                    if name in SCAN_IGNORE_DIR_NAMES:
                        continue
                    stack.append(entry)
                else:
                    yield entry
        except Exception:
            continue


def _find_term_hits(repo_root: Path, terms: list[str], *, max_hits: int = 80) -> list[str]:
    hits: list[str] = []
    terms_lower = [t.lower() for t in terms]
    for path in _walk_repo_files(repo_root):
        if len(hits) >= max_hits:
            break
        if path.suffix.lower() not in SCAN_FILE_EXTS and path.name not in {".env", ".env.local", ".env.example"}:
            continue
        text = _safe_read_text(path)
        if not text:
            continue
        lower = text.lower()
        if any(t in lower for t in terms_lower):
            try:
                hits.append(str(path.relative_to(repo_root)))
            except Exception:
                hits.append(str(path))
    return hits


def _rank_match(path: str, line: str) -> tuple[str, int, str]:
    p = (path or "").lower()
    l = (line or "").lower()

    score = 0
    reasons: list[str] = []

    if Path(p).name in SCAN_IGNORE_FILE_NAMES or any(x in p for x in ["node_modules/", "node_modules\\"]):
        score -= 200
        reasons.append("lockfile/vendor noise")

    if any(k in p for k in ["ai", "llm", "chat", "gemini", "openai", "provider", "router", "service"]):
        score += 60
        reasons.append("filename suggests AI/provider code")

    if any(k in p for k in ["api", "route", "routes", "server", "worker", "functions", "edge", "handlers"]):
        score += 45
        reasons.append("path suggests backend route")

    if any(k in p for k in [".env", "wrangler.toml", "package.json", "vite.config", "next.config", "remix.config"]):
        score += 35
        reasons.append("config/env file")

    if any(k in p for k in ["mock", "mocks", "fixture", "fixtures", "seed", "demo", "placeholder", "fake"]):
        score += 35
        reasons.append("placeholder/mock-like file")

    if "lovable" in l and ("http://" in l or "https://" in l):
        score += 50
        reasons.append("hardcoded URL contains lovable")

    if any(k in l for k in ["fetch(", "axios", "openai", "gemini", "/api", "client.responses", "generative"]):
        score += 25
        reasons.append("looks like network/provider call site")

    category = "other"
    if score < 0:
        category = "noise"
    if score >= 90 and any("ai" in r for r in reasons) or "provider" in p or "router" in p:
        category = "likely AI provider file"
    elif any("backend route" in r for r in reasons):
        category = "likely backend route"
    elif any("config/env file" == r for r in reasons) or ".env" in p:
        category = "likely config/env file"
    elif any("placeholder/mock-like file" == r for r in reasons):
        category = "likely placeholder/mock data source"

    reason = "; ".join(reasons) if reasons else "matched lovable text"
    return (category, score, reason)


def _find_term_matches_with_snippets(
    repo_root: Path,
    terms: list[str],
    *,
    max_hits: int = 160,
) -> list[MatchHit]:
    hits: list[MatchHit] = []
    terms_lower = [t.lower() for t in terms]
    for path in _walk_repo_files(repo_root):
        if len(hits) >= max_hits:
            break
        if path.name in SCAN_IGNORE_FILE_NAMES:
            continue
        if path.suffix.lower() not in SCAN_FILE_EXTS and path.name not in {".env", ".env.local", ".env.example"}:
            continue
        try:
            if path.exists() and path.is_file() and path.stat().st_size > 1_500_000:
                continue
        except Exception:
            continue
        text = _safe_read_text(path)
        if not text:
            continue
        lines = text.splitlines()
        for i, line in enumerate(lines, start=1):
            lower = line.lower()
            matched_term = next((t for t in terms_lower if t in lower), None)
            if not matched_term:
                continue
            try:
                rel = str(path.relative_to(repo_root))
            except Exception:
                rel = str(path)
            category, score, reason = _rank_match(rel, line)
            hits.append(
                MatchHit(
                    path=rel,
                    line_no=i,
                    line=line.strip()[:240],
                    term=matched_term,
                    category=category,
                    score=score,
                    reason=reason,
                )
            )
            if len(hits) >= max_hits:
                break
    hits.sort(key=lambda h: (-h.score, h.path, h.line_no))
    return hits


_ENV_REF_PATTERNS: list[re.Pattern] = [
    re.compile(r"\bprocess\.env\.([A-Z][A-Z0-9_]{2,})\b"),
    re.compile(r"\bimport\.meta\.env\.([A-Z][A-Z0-9_]{2,})\b"),
    re.compile(r"\bos\.getenv\(\s*[\"']([A-Z][A-Z0-9_]{2,})[\"']\s*\)"),
    re.compile(r"\bDeno\.env\.get\(\s*[\"']([A-Z][A-Z0-9_]{2,})[\"']\s*\)"),
    re.compile(r"\benv\[\s*[\"']([A-Z][A-Z0-9_]{2,})[\"']\s*\]"),
]


def _extract_env_var_refs(repo_root: Path, *, max_vars: int = 120) -> list[str]:
    found: set[str] = set()
    for path in _walk_repo_files(repo_root):
        if len(found) >= max_vars:
            break
        if path.suffix.lower() not in SCAN_FILE_EXTS:
            continue
        text = _safe_read_text(path)
        if not text:
            continue
        for pat in _ENV_REF_PATTERNS:
            for match in pat.findall(text):
                if isinstance(match, tuple):
                    # defensive: findall can return tuples for multiple capture groups
                    match = match[0]
                name = (match or "").strip()
                if name:
                    found.add(name)
                    if len(found) >= max_vars:
                        break
            if len(found) >= max_vars:
                break
    return sorted(found)


def _parse_env_file(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    text = _safe_read_text(path, max_bytes=400_000)
    if not text:
        return data
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key:
            data[key] = value
    return data


def _merge_env_sources(repo_root: Path) -> dict[str, str]:
    merged: dict[str, str] = {}
    for fname in [".env", ".env.local", ".env.development", ".env.production"]:
        p = repo_root / fname
        if p.exists():
            merged.update(_parse_env_file(p))

    # Normalize common "same thing, different name" env vars so preflight doesn't
    # keep asking for a key you already have under a different label.
    #
    # Etsy API v3 commonly refers to the app key as "Client ID" in the dashboard,
    # but code may expect ETSY_API_KEY. Treat ETSY_CLIENT_ID as an alias.
    if not (merged.get("ETSY_API_KEY") or "").strip() and (merged.get("ETSY_CLIENT_ID") or "").strip():
        merged["ETSY_API_KEY"] = merged.get("ETSY_CLIENT_ID", "")
    # Some code/docs refer to the Etsy secret as "shared secret".
    if not (merged.get("ETSY_SHARED_SECRET") or "").strip() and (merged.get("ETSY_CLIENT_SECRET") or "").strip():
        merged["ETSY_SHARED_SECRET"] = merged.get("ETSY_CLIENT_SECRET", "")

    # Email: treat RESEND_FROM_EMAIL as an alias for MAIL_FROM in older projects.
    if not (merged.get("MAIL_FROM") or "").strip() and (merged.get("RESEND_FROM_EMAIL") or "").strip():
        merged["MAIL_FROM"] = merged.get("RESEND_FROM_EMAIL", "")

    return merged


def _service_requirements_from_env_vars(env_vars: list[str]) -> dict[str, list[str]]:
    req: dict[str, list[str]] = {}

    def add(service: str, keys: list[str]):
        current = req.get(service, [])
        for k in keys:
            if k not in current:
                current.append(k)
        req[service] = current

    for v in env_vars:
        u = v.upper()
        if u.startswith("SHOPIFY_"):
            add("Shopify", [u])
        if u.startswith("ETSY_"):
            add("Etsy", [u])
        if u.startswith("SUPABASE_") or u.startswith("VITE_SUPABASE_"):
            add("Supabase", [u])
        if u in {"GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"} or u.startswith("GEMINI_"):
            add("Gemini", [u])
        if u.startswith("OPENAI_"):
            add("OpenAI", [u])
        if u.startswith("CLOUDFLARE_") or u in {"CF_API_TOKEN", "CF_ACCOUNT_ID"}:
            add("Cloudflare", [u])
        if u.startswith("RESEND_") or u.startswith("ZOHO_") or u.startswith("SMTP_") or u.startswith("MAIL_"):
            add("Email", [u])

    # Provide a minimal sensible default set when a service is detected but env refs are missing/obfuscated.
    if "Shopify" in req:
        add("Shopify", ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_STORE_DOMAIN"])
    if "Etsy" in req:
        # Etsy's "API key" is often labeled "Client ID" in the Etsy dashboard.
        # Support both naming conventions; the setup wizard/preflight will accept either.
        add("Etsy", ["ETSY_API_KEY", "ETSY_SHARED_SECRET", "ETSY_REDIRECT_URI"])
    if "Supabase" in req:
        add("Supabase", ["SUPABASE_URL", "SUPABASE_ANON_KEY"])
    if "Gemini" in req:
        add("Gemini", ["GEMINI_API_KEY"])
    if "Cloudflare" in req:
        add("Cloudflare", ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"])
    if "Email" in req:
        add("Email", ["RESEND_API_KEY", "MAIL_FROM"])

    return req


def _mask_secret(value: str) -> str:
    v = (value or "").strip()
    if not v:
        return ""
    if len(v) <= 6:
        return "*" * len(v)
    return v[:2] + "*" * (len(v) - 4) + v[-2:]


def _rewrite_lovable_url_to_local_route(text: str) -> str:
    """
    Convert hardcoded https://*.lovable.dev/... URLs into local routes like /api/ai/... or /api/email/...
    This avoids producing broken URLs like https://email./api/ai/...
    """

    def repl(match: re.Match) -> str:
        sub = (match.group("sub") or "").strip(".").lower()
        path = match.group("path") or ""
        if not path.startswith("/"):
            path = "/" + path if path else ""

        parts = [p for p in sub.split(".") if p]
        base = "/api/lovable"
        if "ai" in parts or "llm" in parts:
            base = "/api/ai"
        if "email" in parts or "mail" in parts:
            base = "/api/email"

        # Normalize known Lovable service paths into stable internal routes.
        if base == "/api/email" and path.lower().startswith("/v1/send"):
            path = "/send"

        return base + path

    return re.sub(
        r"https?://(?P<sub>[a-z0-9.-]*?)lovable\.dev(?P<path>/[^\s\"']*)?",
        repl,
        text,
        flags=re.IGNORECASE,
    )


def _new_project(
    *,
    name: str,
    repo_path: str = "",
    domain_name: str = "",
    current_host: str = "lovable.dev",
    target_host: str = "",
    pages_url: str = "",
    worker_url: str = "",
    supabase_url: str = "",
    registrar_url: str = "",
    dns_provider_url: str = "",
    hosting_dashboard_url: str = "",
    shopify_admin_url: str = "",
) -> dict:
    return {
        "id": uuid.uuid4().hex,
        "name": name.strip() or "Untitled App",
        "repo_path": repo_path.strip(),
        "domain_name": domain_name.strip(),
        "current_host": current_host.strip() or "lovable.dev",
        "target_host": target_host.strip(),
        "pages_url": pages_url.strip(),
        "worker_url": worker_url.strip(),
        "supabase_url": supabase_url.strip(),
        "registrar_url": registrar_url.strip(),
        "dns_provider_url": dns_provider_url.strip(),
        "hosting_dashboard_url": hosting_dashboard_url.strip(),
        "shopify_admin_url": shopify_admin_url.strip(),
        "dependencies": [],
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }


@dataclass
class Task:
    title: str
    done: bool = False
    created_at: str = ""


class Storage:
    @staticmethod
    def load_json(path: Path, default):
        if not path.exists():
            return default
        try:
            with open(path, "r", encoding="utf-8") as file:
                return json.load(file)
        except Exception:
            return default

    @staticmethod
    def save_json(path: Path, data):
        with open(path, "w", encoding="utf-8") as file:
            json.dump(data, file, indent=2)


class AssistantCore:
    def __init__(self):
        self.tasks = [Task(**t) for t in Storage.load_json(TASKS_FILE, [])]
        self.notes = Storage.load_json(NOTES_FILE, [])
        self.settings = Storage.load_json(SETTINGS_FILE, DEFAULT_SETTINGS)
        self.projects: list[dict] = Storage.load_json(PROJECTS_FILE, [])
        self._merge_default_settings()
        self._ensure_projects_bootstrap()

    def _merge_default_settings(self):
        changed = False
        for key, value in DEFAULT_SETTINGS.items():
            if key not in self.settings:
                self.settings[key] = value
                changed = True
        if changed:
            self.save_settings()

    def save_tasks(self):
        Storage.save_json(TASKS_FILE, [asdict(t) for t in self.tasks])

    def save_notes(self):
        Storage.save_json(NOTES_FILE, self.notes)

    def save_settings(self):
        Storage.save_json(SETTINGS_FILE, self.settings)

    def save_projects(self):
        Storage.save_json(PROJECTS_FILE, self.projects)

    def _ensure_projects_bootstrap(self):
        if self.projects:
            if not (self.settings.get("active_project_id") or "").strip():
                self.settings["active_project_id"] = self.projects[0].get("id", "")
                self.save_settings()
            return

        project = _new_project(
            name=(self.settings.get("domain_name") or "").strip() or "App 1",
            domain_name=(self.settings.get("domain_name") or "").strip(),
            current_host=(self.settings.get("current_host") or "").strip() or "lovable.dev",
            target_host=(self.settings.get("target_host") or "").strip(),
            registrar_url=(self.settings.get("registrar_url") or "").strip(),
            dns_provider_url=(self.settings.get("dns_provider_url") or "").strip(),
            hosting_dashboard_url=(self.settings.get("hosting_dashboard_url") or "").strip(),
            shopify_admin_url=(self.settings.get("shopify_admin_url") or "").strip(),
        )
        self.projects = [project]
        self.save_projects()
        self.settings["active_project_id"] = project["id"]
        self.save_settings()

    def active_project(self) -> dict | None:
        active_id = (self.settings.get("active_project_id") or "").strip()
        if active_id:
            for project in self.projects:
                if project.get("id") == active_id:
                    return project
        return self.projects[0] if self.projects else None

    def _set_active_project(self, project_id: str) -> None:
        self.settings["active_project_id"] = project_id
        self.save_settings()

    def list_apps_pretty(self):
        if not self.projects:
            return "No apps yet. Add one with: add app MyApp"
        active_id = (self.active_project() or {}).get("id")
        lines = []
        for i, project in enumerate(self.projects, start=1):
            mark = "*" if project.get("id") == active_id else " "
            name = project.get("name") or f"App {i}"
            domain = (project.get("domain_name") or "").strip()
            domain_part = f" ({domain})" if domain else ""
            lines.append(f"{i}. {mark} {name}{domain_part}")
        return "\n".join(lines)

    def add_app(self, name: str):
        name = name.strip()
        if not name:
            return "Provide an app name, like: add app IronPhoenixFlow"
        project = _new_project(name=name)
        self.projects.append(project)
        self.save_projects()
        if not (self.settings.get("active_project_id") or "").strip():
            self._set_active_project(project["id"])
        return f"Added app: {project['name']}"

    def use_app(self, selector: str):
        selector = selector.strip()
        if not selector:
            return "Pick an app number or name, like: use app 2"
        if selector.isdigit():
            idx = int(selector) - 1
            if 0 <= idx < len(self.projects):
                self._set_active_project(self.projects[idx].get("id", ""))
                return f"Active app: {self.active_project().get('name')}"
            return "That app number was not found."

        selector_lower = selector.lower()
        for project in self.projects:
            if (project.get("name") or "").lower() == selector_lower:
                self._set_active_project(project.get("id", ""))
                return f"Active app: {self.active_project().get('name')}"
        return "That app name was not found."

    def app_info(self):
        project = self.active_project()
        if not project:
            return "No active app. Add one with: add app MyApp"
        lines = [f"Active app: {project.get('name','(unnamed)')}"]
        for key in [
            "repo_path",
            "domain_name",
            "current_host",
            "target_host",
            "pages_url",
            "worker_url",
            "supabase_url",
            "registrar_url",
            "dns_provider_url",
            "hosting_dashboard_url",
            "shopify_admin_url",
        ]:
            value = (project.get(key) or "").strip()
            if value:
                lines.append(f"- {key}: {value}")
        if len(lines) == 1:
            lines.append("- (no details set yet)")
        lines.append("\nSet fields with: set app domain_name ironphoenixflow.com")
        return "\n".join(lines)

    def set_app_field(self, field: str, value: str):
        field = field.strip()
        if field not in PROJECT_FIELDS:
            valid = ", ".join(sorted(PROJECT_FIELDS))
            return f"Unknown field '{field}'. Valid fields: {valid}"
        project = self.active_project()
        if not project:
            return "No active app. Add one with: add app MyApp"
        project[field] = value.strip()
        self.save_projects()
        return f"Updated {field} for {project.get('name')}."

    def _deps(self) -> list[dict]:
        project = self.active_project()
        if not project:
            return []
        deps = project.get("dependencies")
        if isinstance(deps, list):
            return deps
        project["dependencies"] = []
        return project["dependencies"]

    def add_dependency(self, kind: str, name: str, url: str = ""):
        kind = kind.strip().lower()
        name = name.strip()
        url = url.strip()
        if not kind or not name:
            return "Usage: add dep <kind> <name> [url]"
        if kind not in {"pages", "worker", "supabase", "oauth", "stripe", "email", "dns", "other"}:
            return "Kind must be one of: pages, worker, supabase, oauth, stripe, email, dns, other"

        deps = self._deps()
        deps.append(
            {
                "id": uuid.uuid4().hex,
                "kind": kind,
                "name": name,
                "url": url,
                "owned": "unknown",  # yes/no/unknown
                "status": "todo",  # todo/blocked/done
                "notes": "",
                "created_at": datetime.now().isoformat(timespec="seconds"),
            }
        )
        self.save_projects()
        return f"Added dependency: {kind} - {name}"

    def list_dependencies_pretty(self):
        deps = self._deps()
        if not deps:
            return "No dependencies set. Add one with: add dep supabase Main DB https://xxxx.supabase.co"
        lines = ["Dependencies:"]
        for i, dep in enumerate(deps, start=1):
            status = (dep.get("status") or "todo").strip()
            owned = (dep.get("owned") or "unknown").strip()
            kind = (dep.get("kind") or "other").strip()
            name = (dep.get("name") or "").strip() or f"Dep {i}"
            url = (dep.get("url") or "").strip()
            url_part = f" ({url})" if url else ""
            lines.append(f"{i}. [{status}] ({kind}) {name} - owned: {owned}{url_part}")
        lines.append("\nUpdate: set dep 1 owned yes | set dep 1 status done | set dep 1 url https://...")
        return "\n".join(lines)

    def set_dependency_field(self, index_str: str, field: str, value: str):
        if not index_str.strip().isdigit():
            return "Usage: set dep <number> <field> <value>"
        idx = int(index_str.strip()) - 1
        deps = self._deps()
        if not (0 <= idx < len(deps)):
            return "That dependency number was not found."

        field = field.strip().lower()
        if field not in DEPENDENCY_FIELDS:
            valid = ", ".join(sorted(DEPENDENCY_FIELDS))
            return f"Unknown field '{field}'. Valid fields: {valid}"

        if field == "owned":
            v = value.strip().lower()
            if v not in {"yes", "no", "unknown"}:
                return "owned must be: yes | no | unknown"
            deps[idx]["owned"] = v
        elif field == "status":
            v = value.strip().lower()
            if v not in {"todo", "blocked", "done"}:
                return "status must be: todo | blocked | done"
            deps[idx]["status"] = v
        else:
            deps[idx][field] = value.strip()

        self.save_projects()
        return f"Updated dependency {idx + 1}."

    def remove_dependency(self, index_str: str):
        if not index_str.strip().isdigit():
            return "Usage: delete dep <number>"
        idx = int(index_str.strip()) - 1
        deps = self._deps()
        if not (0 <= idx < len(deps)):
            return "That dependency number was not found."
        removed = deps.pop(idx)
        self.save_projects()
        return f"Removed dependency: {removed.get('name') or '(unnamed)'}"

    def dependency_report(self):
        project = self.active_project() or {}
        deps = self._deps()
        domain = (project.get("domain_name") or "").strip() or "yourdomain.com"

        blockers: list[str] = []
        for dep in deps:
            kind = (dep.get("kind") or "").strip().lower()
            owned = (dep.get("owned") or "unknown").strip().lower()
            status = (dep.get("status") or "todo").strip().lower()
            name = (dep.get("name") or "").strip() or "(unnamed)"
            if status != "done" and kind in {"supabase", "oauth", "stripe"} and owned != "yes":
                blockers.append(f"- {kind}: {name} (owned={owned}, status={status})")

        if not deps:
            return (
                "No dependencies listed yet.\n\n"
                "Start with:\n"
                "- add dep supabase Main DB https://xxxx.supabase.co\n"
                "- add dep pages Frontend https://<project>.pages.dev\n"
                "- add dep worker API https://<name>.<account>.workers.dev\n"
            )

        if blockers:
            return (
                f"Dependency report for {domain}:\n\n"
                "These will block a clean move off Lovable (you need ownership or replacements):\n"
                + "\n".join(blockers)
                + "\n\nTip: if Supabase isn't owned by you, you must either get added as owner/admin or migrate to a new Supabase project."
            )

        return f"Dependency report for {domain}:\n\nNo ownership blockers detected. Next: run `transition checklist` and then cut over DNS."

    def add_task(self, title: str):
        title = title.strip()
        if not title:
            return "Please type a task first."
        self.tasks.append(Task(title=title, created_at=datetime.now().isoformat(timespec="seconds")))
        self.save_tasks()
        return f"Added task: {title}"

    def toggle_task(self, index: int):
        if 0 <= index < len(self.tasks):
            self.tasks[index].done = not self.tasks[index].done
            self.save_tasks()
            state = "done" if self.tasks[index].done else "not done"
            return f"Marked '{self.tasks[index].title}' as {state}."
        return "That task was not found."

    def remove_task(self, index: int):
        if 0 <= index < len(self.tasks):
            removed = self.tasks.pop(index)
            self.save_tasks()
            return f"Removed task: {removed.title}"
        return "That task was not found."

    def add_note(self, text: str):
        text = text.strip()
        if not text:
            return "Please type a note first."
        self.notes.append({"text": text, "created_at": datetime.now().isoformat(timespec="seconds")})
        self.save_notes()
        return "Saved your note."

    def list_tasks_pretty(self):
        if not self.tasks:
            return "No tasks yet."
        lines = []
        for i, task in enumerate(self.tasks, start=1):
            mark = "[x]" if task.done else "[ ]"
            lines.append(f"{i}. {mark} {task.title}")
        return "\n".join(lines)

    def help_text(self):
        return (
            "I can help with simple work.\n\n"
            "Try these:\n"
            "- ai How do I move this app off lovable.dev?\n"
            "- scan project\n"
            "- preflight\n"
            "- find lovable dependencies\n"
            "- continue last fix\n"
            "- run npm install\n"
            "- run npm run build\n"
            "- add app IronPhoenixFlow\n"
            "- list apps\n"
            "- use app 2\n"
            "- app info\n"
            "- set app domain_name ironphoenixflow.com\n"
            "- set app target_host vercel\n"
            "- set app pages_url https://yourproject.pages.dev\n"
            "- supabase login checklist\n"
            "- set app repo_path C:\\Code\\MyApp\n"
            "- add dep supabase Main DB https://xxxx.supabase.co\n"
            "- list deps\n"
            "- set dep 1 owned yes\n"
            "- dependency report\n"
            "- add task buy domain\n"
            "- note Shopify hero section needs faster load\n"
            "- open vscode\n"
            "- open project\n"
            "- open repo\n"
            "- open shopify\n"
            "- open website\n"
            "- open registrar\n"
            "- open dns\n"
            "- open hosting\n"
            "- transition checklist\n"
            "- dns check ironphoenixflow.com\n"
            "- make product seo Gaming Hoodie\n"
            "- draft email refund request\n"
            "- show tasks\n"
            "- calm mode\n"
            "- focus steps\n"
        )

    def _ai_context_text(self) -> str:
        project = self.active_project() or {}
        safe_project = {k: (project.get(k) or "") for k in sorted(PROJECT_FIELDS) if k in project}
        safe_settings = {
            "user_name": self.settings.get("user_name") or "",
            "support_mode": bool(self.settings.get("support_mode", True)),
        }

        tasks = []
        for task in self.tasks[:15]:
            tasks.append({"title": task.title, "done": bool(task.done)})

        notes = []
        for note in self.notes[-8:]:
            text = (note.get("text") or "").strip()
            if text:
                notes.append(text[:500])

        payload = {
            "active_app": safe_project,
            "settings": safe_settings,
            "tasks": tasks,
            "recent_notes": notes,
            "app_purpose": (
                "You are a helpful assistant embedded in a small Tkinter desktop app that tracks tasks/notes and "
                "helps with domain/hosting transitions. Help the user build and operate the app."
            ),
        }
        return json.dumps(payload, indent=2, ensure_ascii=False)

    def ai_answer(self, question: str) -> str:
        question = (question or "").strip()
        if not question:
            return "Usage: ai <question>"

        api_key = (os.getenv("OPENAI_API_KEY") or self.settings.get("openai_api_key") or "").strip()
        if not api_key:
            return (
                "AI is not configured yet.\n"
                "- Option 1 (recommended): set env var OPENAI_API_KEY\n"
                "- Option 2: open Settings and paste your OpenAI API key\n"
                "Then run: ai <question>"
            )

        try:
            from openai import OpenAI  # type: ignore
        except Exception:
            return "Missing dependency: install the OpenAI SDK with `pip install openai`, then try again."

        model = (self.settings.get("openai_model") or "gpt-5-mini").strip()
        context = self._ai_context_text()

        client = OpenAI(api_key=api_key)
        try:
            resp = client.responses.create(
                model=model,
                input=[
                    {
                        "role": "system",
                        "content": (
                            "Be practical and concise. Ask a clarifying question when requirements are ambiguous. "
                            "When suggesting code changes, prefer minimal diffs and give exact filenames."
                        ),
                    },
                    {"role": "user", "content": f"Context:\n{context}\n\nUser question:\n{question}"},
                ],
            )
        except Exception as e:
            return f"AI request failed: {e}"

        text = (getattr(resp, "output_text", "") or "").strip()
        if text:
            return text
        return "AI returned no text output."

    def scan_active_project(self) -> str:
        project = self.active_project()
        if not project:
            return "No active app. Add one with: add app MyApp"
        repo_path = (project.get("repo_path") or "").strip()
        if not repo_path:
            return "No repo_path set for this app. Set it with: set app repo_path C:\\Code\\YourRepo"

        root = Path(repo_path)
        if not root.exists():
            return f"Repo path not found: {repo_path}"
        if not root.is_dir():
            return f"Repo path is not a folder: {repo_path}"

        found: list[str] = []
        for fname in [
            "package.json",
            "wrangler.toml",
            "vite.config.ts",
            "vite.config.js",
            "next.config.js",
            "next.config.mjs",
            "remix.config.js",
            "shopify.app.toml",
            ".env",
            ".env.local",
            ".env.example",
        ]:
            if (root / fname).exists():
                found.append(fname)

        framework = "unknown"
        pkg_path = root / "package.json"
        if pkg_path.exists():
            pkg_text = _safe_read_text(pkg_path, max_bytes=300_000)
            try:
                pkg = json.loads(pkg_text) if pkg_text else {}
            except Exception:
                pkg = {}
            deps = {}
            if isinstance(pkg, dict):
                deps.update(pkg.get("dependencies") or {})
                deps.update(pkg.get("devDependencies") or {})
            dep_names = set(k.lower() for k in deps.keys()) if isinstance(deps, dict) else set()
            if "next" in dep_names or (root / "next.config.js").exists() or (root / "next.config.mjs").exists():
                framework = "nextjs"
            elif "vite" in dep_names or (root / "vite.config.ts").exists() or (root / "vite.config.js").exists():
                framework = "vite"
            elif "@remix-run/react" in dep_names or (root / "remix.config.js").exists():
                framework = "remix"
            else:
                framework = "node"
        elif (root / "requirements.txt").exists() or any((root / n).exists() for n in ["pyproject.toml", "poetry.lock"]):
            framework = "python"

        wrangler_found = (root / "wrangler.toml").exists()
        supabase_found = (root / "supabase").exists() and (root / "supabase").is_dir()

        lovable_terms = ["lovable", "lovable.dev"]
        ai_terms = ["gemini", "openai", "anthropic", "grok", "vertexai", "generativeai", "/api/ai", "llm"]
        oauth_terms = ["etsy", "oauth", "callback", "redirect_uri", "redirect url", "pkce"]
        shopify_terms = ["shopify", "theme", "admin", "shopify.app.toml"]

        lovable_hits = _find_term_hits(root, lovable_terms)
        ai_hits = _find_term_hits(root, ai_terms)
        oauth_hits = _find_term_hits(root, oauth_terms)
        shopify_hits = _find_term_hits(root, shopify_terms)

        blockers: list[str] = []
        if lovable_hits:
            blockers.append("Lovable dependency found (references in repo)")
        if not (root / ".env").exists() and not (root / ".env.local").exists() and (root / ".env.example").exists():
            blockers.append("Env vars not loaded yet (.env.example present)")
        if framework == "unknown":
            blockers.append("Framework not detected yet")

        if not blockers:
            blockers.append("No obvious blockers detected (scan is shallow)")

        next_action = ""
        if lovable_hits:
            next_action = "Find the Lovable-bound AI/service route and replace it (permissioned diff)."
        elif wrangler_found:
            next_action = "Review Worker routes and env vars, then prepare Cloudflare deploy."
        else:
            next_action = "Prepare Cloudflare Pages deploy (build/output + env vars)."

        scan = ProjectScan(
            project_name=(project.get("name") or "App").strip(),
            repo_path=str(root),
            framework=framework,
            found=found,
            lovable_hits=lovable_hits,
            ai_hits=ai_hits,
            oauth_hits=oauth_hits,
            shopify_hits=shopify_hits,
            supabase_found=supabase_found,
            wrangler_found=wrangler_found,
            summary="",
        )

        summary_lines = [
            f"Project: {scan.project_name}",
            f"Repo: {scan.repo_path}",
            f"Framework: {scan.framework}",
            f"Found: {', '.join(scan.found) if scan.found else '(none)'}",
            f"Wrangler: {'yes' if scan.wrangler_found else 'no'} | Supabase: {'yes' if scan.supabase_found else 'no'}",
            "",
            "Main blockers:",
            *[f"- {b}" for b in blockers],
            "",
            "Recommended next action:",
            f"- {next_action}",
            "",
            "Evidence (top hits):",
            f"- Lovable refs: {len(scan.lovable_hits)} file(s)",
            f"- AI-related refs: {len(scan.ai_hits)} file(s)",
            f"- OAuth/Etsy refs: {len(scan.oauth_hits)} file(s)",
            f"- Shopify refs: {len(scan.shopify_hits)} file(s)",
        ]
        scan.summary = "\n".join(summary_lines)

        project["framework"] = scan.framework
        project["last_scanned_at"] = datetime.now().isoformat(timespec="seconds")
        project["blockers"] = blockers
        project["next_action"] = next_action
        project["scan_found_files"] = scan.found
        project["scan_lovable_hits"] = scan.lovable_hits
        project["scan_ai_hits"] = scan.ai_hits
        project["scan_oauth_hits"] = scan.oauth_hits
        project["scan_shopify_hits"] = scan.shopify_hits
        project["scan_wrangler_found"] = bool(scan.wrangler_found)
        project["scan_supabase_found"] = bool(scan.supabase_found)
        project["last_session_summary"] = (
            f"Scanned repo on {project['last_scanned_at']}. Next action: {next_action}"
        )
        self.save_projects()
        return scan.summary

    def find_lovable_matches(self) -> tuple[str, list[MatchHit]]:
        project = self.active_project()
        if not project:
            return ("No active app. Add one with: add app MyApp", [])
        repo_path = (project.get("repo_path") or "").strip()
        if not repo_path:
            return ("No repo_path set for this app. Set it with: set app repo_path C:\\Code\\YourRepo", [])

        root = Path(repo_path)
        if not root.exists() or not root.is_dir():
            return (f"Repo path not found: {repo_path}", [])

        terms = ["lovable", "lovable.dev"]
        hits = _find_term_matches_with_snippets(root, terms)
        hits = [
            h
            for h in hits
            if ".phoenix_helper_backups" not in h.path.replace("\\", "/").lower()
            and ".phoenix_helper/" not in h.path.replace("\\", "/").lower()
            and h.category != "noise"
        ]
        project["lovable_match_hits"] = [asdict(h) for h in hits[:200]]
        project["last_session_summary"] = f"Found {len(hits)} Lovable match hit(s)."
        if hits:
            project["next_action"] = "Inspect the top-ranked Lovable match and draft a patch."
        self.save_projects()

        if not hits:
            return ("No Lovable matches found.", [])

        top = hits[:12]
        lines = []
        lines.append(f"Lovable matches: {len(hits)} hit(s)")
        lines.append("")
        lines.append("Top candidates:")
        for h in top:
            lines.append(f"- [{h.category}] score={h.score} {h.path}:{h.line_no}  {h.line}")
            lines.append(f"  why: {h.reason}")
        lines.append("")
        lines.append("Next: select a match -> Inspect Selected File -> Draft Patch.")
        return ("\n".join(lines), hits)

    def draft_lovable_patch(self, repo_root: Path, hit: MatchHit) -> tuple[str, list[dict], str]:
        if ".phoenix_helper_backups" in hit.path.replace("\\", "/").lower():
            return ("Skipped (backup copy): " + hit.path, [], "")
        target = repo_root / hit.path
        try:
            if target.exists() and target.is_file() and target.stat().st_size > 1_200_000:
                return (f"Skipped (too large to auto-patch safely): {hit.path}", [], "")
        except Exception:
            pass
        original = _safe_read_text(target, max_bytes=3_000_000)
        if not original:
            return ("Could not read file for patch drafting.", [], "")

        new_text = original
        # Replace hardcoded lovable URLs with local backend routes. (Safe default; user can refine later.)
        new_text = _rewrite_lovable_url_to_local_route(new_text)
        # Do NOT do blind string replacement for "lovable.dev" or it can create invalid URLs.

        # If this looks like an email sending function that used Lovable credits, remove/replace LOVABLE_API_KEY usage.
        path_lower = hit.path.replace("\\", "/").lower()
        if "lovable_api_key" in original.lower() and any(k in path_lower for k in ["email", "send", "supabase/functions"]):
            # Rename env var usage to Resend.
            new_text = re.sub(r"\bLOVABLE_API_KEY\b", "RESEND_API_KEY", new_text)
            new_text = new_text.replace('"LOVABLE_API_KEY"', '"RESEND_API_KEY"').replace("'LOVABLE_API_KEY'", "'RESEND_API_KEY'")

            # If we now call our own /api/email route, drop the Authorization header line tied to Lovable.
            if "/api/email" in new_text:
                filtered = []
                for line in new_text.splitlines():
                    l = line.lower()
                    if "authorization" in l and "resend_api_key" in l:
                        continue
                    filtered.append(line)
                new_text = "\n".join(filtered) + ("\n" if new_text.endswith("\n") else "")

        changes: list[dict] = []
        if new_text != original:
            changes.append({"path": str(target), "rel": hit.path, "before": original, "after": new_text, "is_new": False})

        # If we routed to /api/* and this looks like a Cloudflare Pages project, add minimal stub functions if missing.
        functions_dir = repo_root / "functions"
        ai_fn = functions_dir / "api" / "ai.ts"
        email_fn = functions_dir / "api" / "email" / "send.ts"

        needs_ai = changes and ("/api/ai" in new_text)
        needs_email = changes and ("/api/email" in new_text)

        if (needs_ai or needs_email) and not functions_dir.exists():
            # Create functions folder if the repo already looks like a Cloudflare project.
            if (repo_root / "wrangler.toml").exists():
                functions_dir.mkdir(parents=True, exist_ok=True)

        if needs_ai and functions_dir.exists() and functions_dir.is_dir() and not ai_fn.exists():
            stub = (
                "export async function onRequest(context) {\n"
                "  return new Response(\n"
                "    JSON.stringify({ error: 'AI backend not configured yet. Set GEMINI_API_KEY and implement provider call.' }),\n"
                "    { status: 501, headers: { 'content-type': 'application/json' } }\n"
                "  );\n"
                "}\n"
            )
            changes.append(
                {
                    "path": str(ai_fn),
                    "rel": str(ai_fn.relative_to(repo_root)),
                    "before": "",
                    "after": stub,
                    "is_new": True,
                }
            )

        if needs_email and functions_dir.exists() and functions_dir.is_dir() and not email_fn.exists():
            stub = (
                "export async function onRequest(context) {\n"
                "  if (context.request.method !== 'POST') {\n"
                "    return new Response('Method Not Allowed', { status: 405 });\n"
                "  }\n"
                "  const apiKey = context.env?.RESEND_API_KEY;\n"
                "  const from = context.env?.RESEND_FROM_EMAIL;\n"
                "  if (!apiKey || !from) {\n"
                "    return new Response(\n"
                "      JSON.stringify({ error: 'Missing RESEND_API_KEY or RESEND_FROM_EMAIL' }),\n"
                "      { status: 500, headers: { 'content-type': 'application/json' } }\n"
                "    );\n"
                "  }\n"
                "  const payload = await context.request.json().catch(() => ({}));\n"
                "  const to = payload.to;\n"
                "  const subject = payload.subject;\n"
                "  const html = payload.html;\n"
                "  if (!to || !subject || !html) {\n"
                "    return new Response(\n"
                "      JSON.stringify({ error: 'Expected {to, subject, html}' }),\n"
                "      { status: 400, headers: { 'content-type': 'application/json' } }\n"
                "    );\n"
                "  }\n"
                "  const resendRes = await fetch('https://api.resend.com/emails', {\n"
                "    method: 'POST',\n"
                "    headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },\n"
                "    body: JSON.stringify({ from, to, subject, html }),\n"
                "  });\n"
                "  const text = await resendRes.text();\n"
                "  return new Response(text, { status: resendRes.status, headers: { 'content-type': 'application/json' } });\n"
                "}\n"
            )
            changes.append(
                {
                    "path": str(email_fn),
                    "rel": str(email_fn.relative_to(repo_root)),
                    "before": "",
                    "after": stub,
                    "is_new": True,
                }
            )

        if not changes:
            return (
                "No safe automatic patch generated for this match.\n\n"
                "Tip: Inspect the file and look for the exact AI/provider URL or router function; then we can draft a targeted patch.",
                [],
                "",
            )

        diffs: list[str] = []
        for ch in changes:
            before_lines = (ch["before"] or "").splitlines(keepends=True)
            after_lines = (ch["after"] or "").splitlines(keepends=True)
            rel = ch["rel"]
            diff = difflib.unified_diff(
                before_lines,
                after_lines,
                fromfile=f"a/{rel}",
                tofile=f"b/{rel}",
                lineterm="",
            )
            diffs.append("\n".join(diff))

        return (
            f"Drafted {len(changes)} file change(s). Review diff, then Apply Patch.",
            changes,
            "\n\n".join(diffs).strip(),
        )

    def apply_file_changes_with_backup(self, repo_root: Path, changes: list[dict]) -> str:
        if not changes:
            return "No changes to apply."
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        project = self.active_project() or {}
        project_id = (project.get("id") or "project").strip() or "project"
        safe_project_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", project_id)
        backup_root = DATA_DIR / "backups" / safe_project_id / stamp
        backup_root.mkdir(parents=True, exist_ok=True)

        backups: list[str] = []
        applied: list[str] = []
        for ch in changes:
            path = Path(ch["path"])
            rel = ch.get("rel") or str(path.name)
            try:
                rel_path = Path(rel)
            except Exception:
                rel_path = Path(path.name)

            if path.exists() and path.is_file():
                backup_path = backup_root / rel_path
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                backup_path.write_text(_safe_read_text(path, max_bytes=6_000_000), encoding="utf-8")
                backups.append(str(backup_path))

            path.parent.mkdir(parents=True, exist_ok=True)
            Path(ch["path"]).write_text(ch["after"], encoding="utf-8")
            applied.append(str(path))

        if project is not None:
            project["last_session_summary"] = f"Applied patch with backup at {backup_root}."
            project["last_backup_dir"] = str(backup_root)
            self.save_projects()

        return (
            "Patch applied.\n"
            f"- Backups: {len(backups)} file(s) in {backup_root}\n"
            f"- Updated: {len(applied)} file(s)\n"
            "Next: run a build/test with permission: `run npm run build`."
        )

    def find_etsy_oauth_matches(self) -> tuple[str, list[MatchHit]]:
        project = self.active_project()
        if not project:
            return ("No active app. Add one with: add app MyApp", [])
        repo_path = (project.get("repo_path") or "").strip()
        if not repo_path:
            return ("No repo_path set for this app. Set it with: set app repo_path C:\\Code\\YourRepo", [])

        root = Path(repo_path)
        if not root.exists() or not root.is_dir():
            return (f"Repo path not found: {repo_path}", [])

        terms = [
            "etsy",
            "oauth",
            "redirect_uri",
            "redirect url",
            "etsy.com/oauth/connect",
            "etsy.com/oauth/authorize",
            "ETSY_REDIRECT_URI",
            "redirectUri",
            "redirect_uri=",
            "callback",
            "token",
            "access_token",
            "refresh_token",
            "pkce",
            "verifier",
            "code_challenge",
            "code_verifier",
        ]
        hits = _find_term_matches_with_snippets(root, terms, max_hits=160)

        has_callback = any("callback" in (h.line or "").lower() or "callback" in h.path.lower() for h in hits)
        has_token = any("token" in (h.line or "").lower() for h in hits)
        has_redirect = any("redirect" in (h.line or "").lower() or "redirect_uri" in (h.line or "").lower() for h in hits)

        lines = []
        lines.append(f"Etsy/OAuth matches: {len(hits)} hit(s)")
        lines.append("")
        if not hits:
            lines.append("No OAuth/Etsy references found. If you expect Etsy OAuth, it may be missing entirely.")
            return ("\n".join(lines), [])

        lines.append("Top candidates:")
        for h in hits[:10]:
            lines.append(f"- [{h.category}] score={h.score} {h.path}:{h.line_no}  {h.line}")
            lines.append(f"  why: {h.reason}")
        lines.append("")
        lines.append("Heuristic completeness check:")
        lines.append(f"- Callback handler present: {'yes' if has_callback else 'no'}")
        lines.append(f"- Token exchange logic present: {'yes' if has_token else 'no'}")
        lines.append(f"- Redirect URI references present: {'yes' if has_redirect else 'no'}")
        if not has_callback:
            lines.append("\nMissing: an OAuth callback route/module (the URL Etsy redirects back to).")
        if not has_token:
            lines.append("Missing: token exchange handling (swap code -> access token).")
        if not has_redirect:
            lines.append("Missing: redirect URI wiring (provider console + app config).")
        lines.append("")
        lines.append("Next: Inspect the top match file(s) and we can draft the missing callback/token module.")
        return ("\n".join(lines), hits)

    def find_etsy_redirect_uris(self) -> tuple[str, list[MatchHit]]:
        project = self.active_project()
        if not project:
            return ("No active app. Add one with: add app MyApp", [])
        repo_path = (project.get("repo_path") or "").strip()
        if not repo_path:
            return ("No repo_path set for this app. Set it with: set app repo_path C:\\Code\\YourRepo", [])

        root = Path(repo_path)
        if not root.exists() or not root.is_dir():
            return (f"Repo path not found: {repo_path}", [])

        terms = [
            "redirect_uri",
            "redirectUri",
            "redirect_url",
            "etsy.com/oauth",
            "ETSY_REDIRECT_URI",
            "callback",
            "/callback",
            "auth/etsy/callback",
            "oauth/callback",
        ]
        hits = _find_term_matches_with_snippets(root, terms, max_hits=160)

        for h in hits:
            line_lower = (h.line or "").lower()
            if any(p in line_lower for p in ["http", "https", "etsy.com", "lovable.dev", "redirect_uri="]):
                h.score += 80
                if h.reason:
                    h.reason += "; looks like auth URL construction"
                else:
                    h.reason = "looks like auth URL construction"
            if "callback" in line_lower or "redirect" in (h.path or "").lower():
                h.score += 40

        hits.sort(key=lambda h: (-h.score, h.path, h.line_no))
        if not hits:
            return ("No Etsy redirect_uri references found in code.", [])

        lines = ["Etsy Redirect URI candidates (ranked by likelihood):", ""]
        for i, h in enumerate(hits[:12], 1):
            lines.append(f"{i}. [score={h.score}] {h.path}:{h.line_no}")
            lines.append(f"   {h.line.strip()}")
            lines.append(f"   why: {h.reason}")
        lines.append("")
        lines.append("Next steps:")
        lines.append("- Select the most likely line in the list")
        lines.append("- Inspect file → Draft Patch → replace old URI with your live one")
        lines.append("Example: https://old.lovable.dev/callback → https://ironphoenixflow.com/api/etsy/callback")

        project["etsy_redirect_hits"] = [asdict(h) for h in hits[:80]]
        self.save_projects()
        return ("\n".join(lines), hits)

    def preflight_requirements(self) -> tuple[str, dict[str, list[str]]]:
        project = self.active_project()
        if not project:
            return ("No active app. Add one with: add app MyApp", {})
        repo_path = (project.get("repo_path") or "").strip()
        if not repo_path:
            return ("No repo_path set for this app. Set it with: set app repo_path C:\\Code\\YourRepo", {})
        root = Path(repo_path)
        if not root.exists() or not root.is_dir():
            return (f"Repo path not found: {repo_path}", {})

        # Ensure scan data exists (framework, hits, etc.)
        if not (project.get("last_scanned_at") or "").strip():
            _ = self.scan_active_project()

        env_refs = _extract_env_var_refs(root)
        merged_env = _merge_env_sources(root)

        # Lovable matches can signal required services even when env vars aren't referenced explicitly.
        try:
            lovable_text, lovable_hits = self.find_lovable_matches()
        except Exception:
            lovable_hits = []

        # Detect integrations from scan hits + config files.
        integrations: dict[str, bool] = {
            "Shopify": bool(project.get("scan_shopify_hits")) or (root / "shopify.app.toml").exists(),
            "Etsy": bool(project.get("scan_oauth_hits")),
            "Supabase": bool(project.get("scan_supabase_found")) or bool(project.get("scan_oauth_hits")),
            "Cloudflare": bool(project.get("scan_wrangler_found")) or (root / "wrangler.toml").exists(),
            "Gemini": any(v in env_refs for v in ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"])
            or any("gemini" in p.lower() for p in (project.get("scan_ai_hits") or []) if isinstance(p, str)),
            "OpenAI": any(v.startswith("OPENAI_") for v in env_refs)
            or any("openai" in p.lower() for p in (project.get("scan_ai_hits") or []) if isinstance(p, str)),
            "Email": any(v.startswith("RESEND_") or v.startswith("ZOHO_") or v.startswith("SMTP_") for v in env_refs)
            or any("email.lovable.dev" in (h.line or "").lower() for h in lovable_hits),
        }

        # Allow opting out of integrations that were detected incorrectly or are intentionally not used.
        opt_out = project.get("integration_opt_out") or []
        if isinstance(opt_out, list):
            for s in list(integrations.keys()):
                if s in opt_out:
                    integrations[s] = False

        requirements = _service_requirements_from_env_vars(env_refs)
        # Promote service detection into requirements even if env refs aren't obvious.
        if integrations.get("Shopify") and "Shopify" not in requirements:
            requirements["Shopify"] = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_STORE_DOMAIN"]
        if integrations.get("Etsy") and "Etsy" not in requirements:
            requirements["Etsy"] = ["ETSY_API_KEY", "ETSY_SHARED_SECRET", "ETSY_REDIRECT_URI"]
        if integrations.get("Supabase") and "Supabase" not in requirements:
            requirements["Supabase"] = ["SUPABASE_URL", "SUPABASE_ANON_KEY"]
        if integrations.get("Cloudflare") and "Cloudflare" not in requirements:
            requirements["Cloudflare"] = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]
        if integrations.get("Email") and "Email" not in requirements:
            # Default to Resend; Zoho SMTP can be added later if needed.
            requirements["Email"] = ["RESEND_API_KEY", "MAIL_FROM"]

        # Drop requirements for any opted-out services.
        if isinstance(opt_out, list):
            for s in opt_out:
                try:
                    requirements.pop(s, None)
                except Exception:
                    pass

        # Compute missing keys (empty or absent) but only for detected services.
        missing_by_service: dict[str, list[str]] = {}
        for service, keys in requirements.items():
            if not keys:
                continue
            missing = []
            for key in keys:
                val = (merged_env.get(key) or "").strip().strip('"').strip("'")
                if not val:
                    missing.append(key)
            if missing:
                missing_by_service[service] = missing

        detected = [s for s, ok in integrations.items() if ok]
        lines = []
        lines.append("Preflight scan complete")
        lines.append("")
        lines.append("Detected integrations:")
        if detected:
            for s in sorted(detected):
                lines.append(f"✓ {s}")
        else:
            lines.append("- (none detected yet)")

        lines.append("")
        if missing_by_service:
            lines.append("Missing required env vars:")
            for service, keys in missing_by_service.items():
                lines.append(f"- {service}: " + ", ".join(keys))
        else:
            lines.append("Env looks set (no missing keys detected for detected integrations).")

        # Persist preflight summary.
        project["preflight_detected_integrations"] = sorted(detected)
        project["preflight_missing_env"] = missing_by_service
        project["preflight_env_refs"] = env_refs[:200]
        missing_summary = "none" if not missing_by_service else ", ".join(
            [f"{k}({len(v)})" for k, v in missing_by_service.items()]
        )
        project["last_session_summary"] = f"Preflight on {datetime.now().isoformat(timespec='seconds')}. Missing: {missing_summary}"
        self.save_projects()

        return ("\n".join(lines), missing_by_service)

    def collect_required_keys(self, missing_by_service: dict[str, list[str]] | None) -> list[str]:
        keys_needed: list[str] = []
        for _service, keys in (missing_by_service or {}).items():
            for k in keys or []:
                k = (k or "").strip()
                if k and k not in keys_needed:
                    keys_needed.append(k)
        return keys_needed

    def build_setup_checklist(self, missing_by_service: dict[str, list[str]] | None) -> str:
        """
        Non-technical checklist of what to gather before setup.
        Designed to reduce "click around until something works".
        """
        project = self.active_project() or {}
        detected = project.get("preflight_detected_integrations") or []
        detected = [x for x in detected if isinstance(x, str) and x.strip()]

        lines: list[str] = []
        lines.append("Setup checklist (gather these first)")
        lines.append("")
        lines.append("Detected integrations:")
        if detected:
            for s in sorted(set(detected)):
                lines.append(f"- {s}")
        else:
            lines.append("- (none detected yet)")

        lines.append("")
        lines.append("Keys / values to gather:")
        if missing_by_service:
            for service, keys in missing_by_service.items():
                if not keys:
                    continue
                lines.append(f"- {service}:")
                for k in keys:
                    lines.append(f"  - {k}")
        else:
            lines.append("- (none missing based on current scan)")

        lines.append("")
        lines.append("Where to find them (quick guide):")
        lines.append("- Supabase: Project Settings -> API")
        lines.append("- Etsy: Etsy Developer Portal (app key/client_id + shared secret + redirect URL)")
        lines.append("- Shopify: Shopify Partners Dashboard (API key + API secret + app/store domain)")
        lines.append("- Stripe: Developers -> API keys (publishable is public; secret stays server-only)")
        lines.append("- Email (Resend): API key + from email")
        lines.append("- AI (Gemini/OpenAI): API key (server-only)")
        lines.append("")
        lines.append("Tip: Only fill what you actually use. Extra keys = extra confusion.")

        return "\n".join(lines)

    def write_setup_checklist(self, repo_root: Path, checklist_text: str) -> str:
        out_path = repo_root / "API_KEYS_NEEDED.md"
        try:
            out_path.write_text(checklist_text + "\n", encoding="utf-8")
            return f"Wrote checklist: {out_path}"
        except Exception as e:
            return f"Could not write checklist to repo: {e}"

    def build_env_patch_preview(self, repo_root: Path, values: dict[str, str]) -> str:
        env_local = repo_root / ".env.local"
        env_file = repo_root / ".env"
        gitignore = repo_root / ".gitignore"

        existing_local = _parse_env_file(env_local) if env_local.exists() else {}
        existing_env = _parse_env_file(env_file) if env_file.exists() else {}

        set_local: dict[str, str] = dict(existing_local)
        for k, v in values.items():
            set_local[k] = v

        # Keep .env as a template unless it already has real values; we won't inject secrets there by default.
        desired_env: dict[str, str] = dict(existing_env)
        for k in sorted(values.keys()):
            if k not in desired_env:
                desired_env[k] = ""

        changes: list[str] = []

        def describe_env_changes(label: str, before: dict[str, str], after: dict[str, str], *, mask: bool):
            for k in sorted(after.keys()):
                b = (before.get(k) or "").strip()
                a = (after.get(k) or "").strip()
                if b == a:
                    continue
                if mask:
                    changes.append(f"{label}: {k} = {_mask_secret(a)}")
                else:
                    changes.append(f"{label}: {k} = {a}")

        describe_env_changes(".env.local", existing_local, set_local, mask=True)
        describe_env_changes(".env", existing_env, desired_env, mask=False)

        gi_before = _safe_read_text(gitignore, max_bytes=400_000) if gitignore.exists() else ""
        gi_lines = gi_before.splitlines() if gi_before else []
        gi_set = set(line.strip() for line in gi_lines if line.strip())
        needed_gi = {".env", ".env.local"}
        gi_add = [x for x in sorted(needed_gi) if x not in gi_set]

        out = []
        out.append("Planned changes:")
        out.append("")
        if changes:
            out.append("- Update env files:")
            out.extend([f"  - {c}" for c in changes[:80]])
            if len(changes) > 80:
                out.append(f"  - ...and {len(changes) - 80} more changes")
        else:
            out.append("- No env value changes detected.")

        if gi_add:
            out.append("")
            out.append("- Update .gitignore (add):")
            out.extend([f"  - {x}" for x in gi_add])
        else:
            out.append("")
            out.append("- .gitignore already covers .env files (or not present).")

        return "\n".join(out)

    def apply_env_patch(self, repo_root: Path, values: dict[str, str]) -> str:
        env_local = repo_root / ".env.local"
        env_file = repo_root / ".env"
        gitignore = repo_root / ".gitignore"

        existing_local = _parse_env_file(env_local) if env_local.exists() else {}
        existing_env = _parse_env_file(env_file) if env_file.exists() else {}

        for k, v in values.items():
            existing_local[k] = v

        def write_env(path: Path, data: dict[str, str]):
            lines = []
            for k in sorted(data.keys()):
                v = data.get(k, "")
                lines.append(f"{k}={v}")
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")

        # Write .env.local with collected values
        write_env(env_local, existing_local)

        # Ensure .env contains keys as a template, without injecting secrets by default.
        for k in sorted(values.keys()):
            if k not in existing_env:
                existing_env[k] = ""
        write_env(env_file, existing_env)

        # Update .gitignore
        gi_text = _safe_read_text(gitignore, max_bytes=400_000) if gitignore.exists() else ""
        gi_lines = gi_text.splitlines() if gi_text else []
        gi_set = set(line.strip() for line in gi_lines if line.strip())
        to_add = [x for x in [".env", ".env.local"] if x not in gi_set]
        if to_add:
            new_lines = gi_lines[:]
            if new_lines and new_lines[-1].strip():
                new_lines.append("")
            new_lines.append("# Env files (added by Phoenix Helper)")
            new_lines.extend(to_add)
            gitignore.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

        project = self.active_project()
        if project is not None:
            project["setup_completed_at"] = datetime.now().isoformat(timespec="seconds")
            project["last_session_summary"] = f"Setup wizard wrote .env.local on {project['setup_completed_at']}."
            self.save_projects()

        verify = self.verify_project_setup(repo_root)

        return (
            "Setup complete:\n"
            f"- Wrote {env_local}\n"
            f"- Wrote {env_file}\n"
            + (f"- Updated {gitignore}\n" if to_add else "")
            + "\n\n"
            + verify
            + "\n\nNext: run a build/test with permission: `run npm install` then `run npm run build`."
        )

    def verify_project_setup(self, repo_root: Path) -> str:
        merged = _merge_env_sources(repo_root)
        preflight_text, missing_by_service = self.preflight_requirements()

        # Basic format checks (no network).
        warnings: list[str] = []
        supa_url = (merged.get("SUPABASE_URL") or merged.get("VITE_SUPABASE_URL") or "").strip().strip('"').strip("'")
        if supa_url and not (supa_url.startswith("https://") or supa_url.startswith("http://")):
            warnings.append("Supabase URL does not look like a URL (should start with https://).")

        shop = (merged.get("SHOPIFY_STORE_DOMAIN") or "").strip().strip('"').strip("'")
        if shop and " " in shop:
            warnings.append("Shopify store domain has spaces; it should be a hostname like yourstore.myshopify.com.")

        cf_token = (merged.get("CLOUDFLARE_API_TOKEN") or merged.get("CF_API_TOKEN") or "").strip().strip('"').strip("'")
        if cf_token and len(cf_token) < 20:
            warnings.append("Cloudflare API token looks unusually short; verify you pasted the full token.")

        lines = []
        lines.append("Verify (local checks):")
        if missing_by_service:
            lines.append("⚠ Missing keys remain:")
            for svc, keys in missing_by_service.items():
                lines.append(f"- {svc}: " + ", ".join(keys))
        else:
            lines.append("✓ Required keys appear present for detected integrations.")

        if warnings:
            lines.append("")
            lines.append("Warnings:")
            for w in warnings[:10]:
                lines.append(f"- {w}")

        lines.append("")
        lines.append("Tip: run `scan project` again after you install deps/build to find deeper issues.")
        return "\n".join(lines)

    def plan_for_goal(self, goal: str) -> list[str]:
        g = (goal or "").strip().lower()
        if not g:
            return []

        plan: list[str] = []

        if "lovable" in g or "off lovable" in g or "escape lovable" in g:
            plan.extend(
                [
                    "Scan the repo (scan project)",
                    "List Lovable references (find lovable dependencies)",
                    "Identify the AI/router/service file tied to Lovable",
                    "Map env vars needed for deploy (.env, Cloudflare)",
                    "Run local build/tests (run npm install, run npm run build)",
                    "Prepare Cloudflare Pages/Worker deploy checklist",
                    "Verify domain cutover readiness (DNS + redirects + HTTPS)",
                ]
            )

        if "cloudflare" in g or "pages" in g or "worker" in g or "deploy" in g:
            plan.extend(
                [
                    "Confirm build command + output folder",
                    "Confirm env vars (Supabase/OAuth/API keys)",
                    "Attach custom domain + www redirect",
                    "Smoke test key flows (login/checkout/forms)",
                ]
            )

        if "etsy" in g or "oauth" in g:
            plan.extend(
                [
                    "Search repo for Etsy OAuth config and redirect URIs",
                    "Confirm callback route exists in app",
                    "Confirm provider console callback matches production domain",
                ]
            )

        if "shopify" in g or "theme" in g:
            plan.extend(
                [
                    "Open Shopify admin URL",
                    "List theme issue symptoms and affected pages",
                    "Check theme/app embed settings and storefront errors",
                ]
            )

        if "suno" in g or "songs" in g or "music" in g:
            plan.extend(
                [
                    "Define site music map (pages + moods + durations)",
                    "Batch-generate drafts and keep top picks",
                    "Export + name files consistently for the site",
                ]
            )

        # Deduplicate while preserving order
        seen = set()
        deduped: list[str] = []
        for item in plan:
            if item not in seen:
                seen.add(item)
                deduped.append(item)
        return deduped[:25]

    def calm_mode_text(self):
        return (
            "Take one small step.\n"
            "1. Breathe in for 4 seconds.\n"
            "2. Breathe out for 4 seconds.\n"
            "3. Pick one tiny task only.\n"
            "4. Finish that task before starting the next one."
        )

    def focus_steps_text(self):
        return (
            "Focus plan:\n"
            "1. Open one folder.\n"
            "2. Open one file.\n"
            "3. Fix one thing.\n"
            "4. Save.\n"
            "5. Test.\n"
            "6. Write one note about what changed."
        )

    def generate_shopify_seo(self, product_name: str = "Gaming Hoodie"):
        name = product_name.strip() or "Gaming Hoodie"
        keyword1 = f"{name} Gift"
        keyword2 = f"{name} Style"
        title1 = self._four_word_phrase(keyword1)
        title2 = self._four_word_phrase(keyword2)
        description = (
            f"### {title1}\n"
            f"Bring bold energy to your setup with this {name.lower()}. "
            f"It adds a thrilling look and easy style for daily wear.\n\n"
            f"### Why It Stands Out\n"
            f"This piece fits gaming rooms, stream nights, and relaxed days. "
            f"It keeps your look clean, strong, and easy to match.\n\n"
            "- Great for gifts\n"
            "- Easy to style\n"
            "- Strong themed vibe\n\n"
            f"### {title2}\n"
            f"Use this design to build a clear brand mood across your shop. "
            f"It gives shoppers a fast reason to click and remember your item.\n\n"
            "Ready to build the listing? Add your features, size details, and shipping notes next."
        )
        meta = (
            f"{title1} for gamers who want a bold, exciting style. Great gift idea with a strong themed vibe and easy everyday wear."
        )
        return (
            f"Title idea 1: {title1}\n"
            f"Title idea 2: {title2}\n\n"
            f"Keyword phrase 1: {title1}\n"
            f"Keyword phrase 2: {title2}\n\n"
            f"{description}\n\n"
            f"Meta description: {meta[:140]}"
        )

    def _four_word_phrase(self, text: str):
        words = re.findall(r"[A-Za-z0-9']+", text)
        while len(words) < 4:
            words.append("Guide")
        return " ".join(words[:4]).title()

    def draft_email(self, subject: str = "Hello", purpose: str = "customer support"):
        return (
            f"Subject: {subject}\n\n"
            "Hello,\n\n"
            f"Thank you for your message about {purpose}. We are happy to help. "
            "Please send any order number, screenshots, or details that can help us review this quickly.\n\n"
            "Best regards,\n"
            "Support Team"
        )

    def send_email(self, to_email: str, subject: str, body: str):
        email_user = self.settings.get("smtp_email", "").strip()
        email_pass = self.settings.get("smtp_password", "").strip()
        smtp_server = self.settings.get("smtp_server", "smtp.gmail.com").strip()
        smtp_port = int(self.settings.get("smtp_port", 587))

        if not email_user or not email_pass:
            return "Email is not set up yet. Open Settings and add SMTP email and password."

        msg = MIMEMultipart()
        msg["From"] = email_user
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        try:
            with smtplib.SMTP(smtp_server, smtp_port) as server:
                server.starttls()
                server.login(email_user, email_pass)
                server.sendmail(email_user, to_email, msg.as_string())
            return f"Email sent to {to_email}."
        except Exception as e:
            return f"Email failed: {e}"

    def _popen(self, command, *, use_shell=False):
        try:
            if use_shell and isinstance(command, list):
                command = " ".join(command)
            subprocess.Popen(command, shell=use_shell)
            return None
        except Exception as e:
            return str(e)

    def open_vscode(self):
        err = self._popen("code", use_shell=True)
        return "Opened VS Code." if not err else f"Could not open VS Code: {err}"

    def open_project_folder(self, folder=None):
        target = folder or self.settings.get("default_project_folder", str(Path.home()))
        err = self._popen(["code", f"\"{target}\""], use_shell=True)
        return f"Opened project folder: {target}" if not err else f"Could not open project folder: {err}"

    def open_data_folder(self):
        err = self._popen(["explorer", str(DATA_DIR)], use_shell=True)
        return f"Opened data folder: {DATA_DIR}" if not err else f"Could not open data folder: {err}"

    def open_shopify(self):
        project = self.active_project() or {}
        url = (project.get("shopify_admin_url") or self.settings.get("shopify_admin_url") or "").strip()
        if not url:
            return "Add your Shopify admin URL in Settings first."
        webbrowser.open(url)
        return "Opened Shopify admin."

    def open_website(self):
        project = self.active_project() or {}
        domain = ((project.get("domain_name") or "").strip() or (self.settings.get("domain_name") or "").strip())
        if not domain:
            return "Add your domain name in Settings first."
        url = domain if domain.startswith("http") else f"https://{domain}"
        webbrowser.open(url)
        return f"Opened {url}."

    def open_registrar(self):
        project = self.active_project() or {}
        url = ((project.get("registrar_url") or "").strip() or (self.settings.get("registrar_url") or "").strip())
        if not url:
            return "Add your registrar URL in Settings first (where you bought the domain)."
        webbrowser.open(url)
        return "Opened registrar."

    def open_dns(self):
        project = self.active_project() or {}
        url = ((project.get("dns_provider_url") or "").strip() or (self.settings.get("dns_provider_url") or "").strip())
        if not url:
            return "Add your DNS provider URL in Settings first."
        webbrowser.open(url)
        return "Opened DNS provider."

    def open_hosting(self):
        project = self.active_project() or {}
        url = (
            (project.get("hosting_dashboard_url") or "").strip()
            or (self.settings.get("hosting_dashboard_url") or "").strip()
        )
        if not url:
            return "Add your hosting dashboard URL in Settings first."
        webbrowser.open(url)
        return "Opened hosting dashboard."

    def transition_checklist(self, domain: str | None = None):
        project = self.active_project() or {}
        domain_name = (domain or project.get("domain_name") or self.settings.get("domain_name") or "").strip() or "yourdomain.com"
        current_host = (project.get("current_host") or self.settings.get("current_host") or "").strip() or "your current host"
        target_host = (project.get("target_host") or self.settings.get("target_host") or "").strip() or "your new host"
        return (
            f"Transition checklist for {domain_name} (from {current_host} to {target_host}):\n\n"
            "1) Pick the destination\n"
            "   - Where will the real site live? (Vercel/Netlify/Shopify/WordPress/custom server)\n"
            "   - Make sure you can add a custom domain + SSL.\n\n"
            "2) Prep cutover\n"
            "   - Lower DNS TTL (e.g., 300 seconds) 12-24 hours before changes.\n"
            "   - Decide the canonical URL (https + www vs non-www).\n\n"
            "3) Build/verify on the new host\n"
            "   - Deploy the same site content.\n"
            "   - Test all key pages, forms, and checkout.\n"
            "   - Confirm analytics + pixels + email capture still work.\n\n"
            "4) Connect the domain\n"
            "   - Add the domain in your new hosting dashboard.\n"
            "   - Update DNS records (A/AAAA/CNAME) per the new host instructions.\n"
            "   - Wait for SSL to issue, then test again.\n\n"
            "5) Preserve SEO + links\n"
            "   - Set 301 redirects from the old paths if URLs changed.\n"
            "   - Keep sitemap + robots.txt correct.\n\n"
            "6) Final checks\n"
            "   - Run `dns check` and open the site in an incognito window.\n"
            "   - Monitor for 404s, payment errors, and broken forms.\n\n"
            "Tell me your target host (Vercel, Netlify, Shopify, etc.) and I can tailor step 4 exactly."
        )

    def dns_check(self, domain: str):
        domain = domain.strip()
        if not domain:
            project = self.active_project() or {}
            domain = ((project.get("domain_name") or "").strip() or (self.settings.get("domain_name") or "").strip())
        if not domain:
            return "Provide a domain, like: dns check ironphoenixflow.com"
        try:
            result = subprocess.run(
                ["nslookup", domain],
                capture_output=True,
                text=True,
                timeout=20,
                shell=False,
            )
        except Exception as e:
            return f"DNS check failed: {e}"

        text = (result.stdout or "").strip()
        err = (result.stderr or "").strip()
        if not text and err:
            return f"DNS check output:\n{err}"
        if not text:
            return "DNS check returned no output."
        return f"DNS check output:\n{text}"

    def supabase_login_checklist(self):
        project = self.active_project() or {}
        domain = (project.get("domain_name") or "").strip() or "yourdomain.com"
        pages_url = (project.get("pages_url") or "").strip()
        worker_url = (project.get("worker_url") or "").strip()

        site_url = f"https://{domain}"
        redirects = [f"https://{domain}/*", f"https://www.{domain}/*", "http://localhost:5173/*"]
        if pages_url:
            redirects.append(f"{pages_url.rstrip('/')}" + "/*")

        extra = ""
        if worker_url:
            extra = (
                "\n\nWorker tip:\n"
                "- If you use a Worker for Gemini/API, keep auth on the Pages origin.\n"
                "- Best: route Worker as `https://{domain}/api/*` (same-site) to avoid CORS/cookie issues."
            ).format(domain=domain)

        return (
            "Supabase login checklist (Cloudflare Pages):\n\n"
            "1) Supabase Dashboard -> Auth -> URL Configuration\n"
            f"- Site URL: {site_url}\n"
            "- Redirect URLs (add these):\n"
            + "\n".join([f"  - {u}" for u in redirects])
            + "\n\n"
            "2) Cloudflare Pages -> Settings -> Environment variables\n"
            "- Ensure your frontend build has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.\n\n"
            "3) If using Google/GitHub OAuth:\n"
            "- Update the provider console's authorized redirect URI(s) to match the new domain.\n"
            + extra
        )

    def save_settings_from_form(self, values: dict):
        self.settings.update(values)
        self.save_settings()
        project = self.active_project()
        if project:
            for key in [
                "domain_name",
                "current_host",
                "target_host",
                "pages_url",
                "worker_url",
                "supabase_url",
                "registrar_url",
                "dns_provider_url",
                "hosting_dashboard_url",
                "shopify_admin_url",
            ]:
                if key in values:
                    project[key] = (values.get(key) or "").strip()
            self.save_projects()
        return "Settings saved."

    def handle_command(self, command: str):
        command = command.strip()
        lower = command.lower()

        if not command:
            return "Type something so I can help."
        if lower == "ai":
            return "Usage: ai <question> (configure OPENAI_API_KEY or Settings -> openai_api_key)"
        if lower.startswith("ai "):
            return self.ai_answer(command[3:])
        if lower in {"scan project", "scan this project", "scan repo", "scan"}:
            return self.scan_active_project()
        if lower in {"preflight", "preflight setup", "requirements", "setup requirements"}:
            text, _missing = self.preflight_requirements()
            return text + "\n\nUse the Setup Project button to collect only needed keys and write .env files."
        if lower in {"find lovable dependencies", "find lovable", "find lovable refs"}:
            text, _hits = self.find_lovable_matches()
            return text
        if lower in {"find etsy redirect", "etsy redirect", "etsy uri", "check etsy uri"}:
            text, _hits = self.find_etsy_redirect_uris()
            return text
        if lower in {"continue last fix", "continue last task", "continue"}:
            project = self.active_project() or {}
            summary = (project.get("last_session_summary") or "").strip()
            next_action = (project.get("next_action") or "").strip()
            if not summary and not next_action:
                return "No saved session for this app yet. Run: scan project"
            return (
                "Last session:\n"
                f"{summary or '(none)'}\n\n"
                "Next best action:\n"
                f"- {next_action or '(none)'}\n\n"
                "Run: scan project | preflight | find lovable dependencies"
            )
        if lower in {"help", "what can you do", "commands"}:
            return self.help_text()
        if lower.startswith("add app "):
            return self.add_app(command[8:])
        if lower in {"list apps", "show apps"}:
            return self.list_apps_pretty()
        if lower.startswith("use app "):
            return self.use_app(command[8:])
        if lower in {"app info", "show app"}:
            return self.app_info()
        if lower.startswith("set app "):
            rest = command[8:].strip()
            if " " not in rest:
                return "Usage: set app <field> <value>"
            field, value = rest.split(" ", 1)
            return self.set_app_field(field, value)
        if lower in {"supabase login checklist", "supabase checklist"}:
            return self.supabase_login_checklist()
        if lower.startswith("add dep "):
            rest = command[8:].strip()
            parts = rest.split(" ", 2)
            if len(parts) < 2:
                return "Usage: add dep <kind> <name> [url]"
            kind = parts[0]
            name = parts[1]
            url = parts[2] if len(parts) == 3 else ""
            return self.add_dependency(kind, name, url)
        if lower in {"list deps", "show deps"}:
            return self.list_dependencies_pretty()
        if lower.startswith("set dep "):
            rest = command[8:].strip()
            parts = rest.split(" ", 2)
            if len(parts) < 3:
                return "Usage: set dep <number> <field> <value>"
            return self.set_dependency_field(parts[0], parts[1], parts[2])
        if lower.startswith("delete dep "):
            return self.remove_dependency(command[11:].strip())
        if lower in {"dependency report", "deps report"}:
            return self.dependency_report()
        if lower.startswith("add task "):
            return self.add_task(command[9:])
        if lower == "show tasks":
            return self.list_tasks_pretty()
        if lower.startswith("note "):
            return self.add_note(command[5:])
        if lower == "open vscode":
            return self.open_vscode()
        if lower == "open project":
            return self.open_project_folder()
        if lower == "open repo":
            project = self.active_project() or {}
            repo_path = (project.get("repo_path") or "").strip()
            if not repo_path:
                return "Set a repo path first, like: set app repo_path C:\\Code\\MyApp"
            return self.open_project_folder(repo_path)
        if lower == "open data":
            return self.open_data_folder()
        if lower == "open shopify":
            return self.open_shopify()
        if lower == "open website":
            return self.open_website()
        if lower == "open registrar":
            return self.open_registrar()
        if lower == "open dns":
            return self.open_dns()
        if lower == "open hosting":
            return self.open_hosting()
        if lower == "calm mode":
            return self.calm_mode_text()
        if lower == "focus steps":
            return self.focus_steps_text()
        if lower.startswith("make product seo"):
            product = command.replace("make product seo", "", 1).strip() or "Gaming Hoodie"
            return self.generate_shopify_seo(product)
        if lower.startswith("draft email"):
            details = command.replace("draft email", "", 1).strip() or "customer support"
            return self.draft_email("Quick Follow Up", details)
        if lower.startswith("transition checklist"):
            rest = command[len("transition checklist") :].strip()
            return self.transition_checklist(rest or None)
        if lower.startswith("dns check"):
            rest = command[len("dns check") :].strip()
            return self.dns_check(rest)

        return (
            "I did not understand that yet. Try: help, add app, list apps, use app, app info, set app, add task, note, open vscode, "
            "open project, open repo, open shopify, open website, transition checklist, dns check, make product seo, draft email, "
            "add dep, list deps, set dep, delete dep, or dependency report."
        )


class AssistantUI:
    def __init__(self, root: Tk):
        self.root = root
        self.root.title(f"{APP_NAME} v{APP_VERSION}")
        self.root.geometry("1100x760")
        self.core = AssistantCore()

        def _tk_exception(_exc, val, tb):
            try:
                _log_unhandled("tkinter", val if isinstance(val, BaseException) else Exception(str(val)))
            except Exception:
                pass
            try:
                messagebox.showerror(
                    APP_NAME,
                    f"The app hit an error and stopped an action.\n\n{val}\n\nOpen the log for details.",
                    parent=self.root,
                )
            except Exception:
                pass
            try:
                self.log_event(f"ERROR: {val}")
            except Exception:
                pass

        self.root.report_callback_exception = _tk_exception

        main = Frame(root)
        main.pack(fill=BOTH, expand=True)

        top = Frame(main)
        top.pack(side=TOP, fill=X, padx=10, pady=(10, 6))

        left_panel = Frame(top, width=260)
        left_panel.pack(side=LEFT, fill=Y)
        Label(left_panel, text="Projects").pack(anchor="w")

        self.project_list = Listbox(left_panel, selectmode=SINGLE, width=34, height=10)
        self.project_list.pack(fill=BOTH, expand=True)
        self.project_list.bind("<<ListboxSelect>>", self.on_project_select)

        proj_btns = Frame(left_panel)
        proj_btns.pack(fill=X, pady=(6, 0))
        Button(proj_btns, text="Add Project", command=self.add_project_prompt).pack(side=LEFT, padx=2)
        Button(proj_btns, text="Pick Repo", command=self.pick_repo_for_active).pack(side=LEFT, padx=2)

        center_panel = Frame(top)
        center_panel.pack(side=LEFT, fill=BOTH, expand=True, padx=(10, 10))
        Label(center_panel, text="Project Details").pack(anchor="w")

        self.details = Text(center_panel, wrap="word", height=8)
        self.details.pack(fill=X, expand=False)

        Label(center_panel, text="Lovable Matches (ranked)").pack(anchor="w", pady=(8, 0))
        matches_frame = Frame(center_panel)
        matches_frame.pack(fill=BOTH, expand=True)
        matches_scroll = Scrollbar(matches_frame)
        matches_scroll.pack(side=RIGHT, fill=Y)
        self.matches_list = Listbox(matches_frame, selectmode=SINGLE, yscrollcommand=matches_scroll.set)
        self.matches_list.pack(side=LEFT, fill=BOTH, expand=True)
        matches_scroll.config(command=self.matches_list.yview)
        self.matches_list.bind("<<ListboxSelect>>", lambda _e: self._on_match_select())
        self.matches_list.bind("<Double-Button-1>", lambda _e: self.inspect_selected_file())
        self.matches: list[MatchHit] = []
        self.selected_match_index: int | None = None
        self.draft_changes: list[dict] = []
        self.draft_diff: str = ""
        self._auto_fix_active = False
        self._auto_fix_tried: set[str] = set()
        self._auto_fix_applied = 0
        self._auto_fix_max = 10  # requested: aim for 10 applied patches per run

        right_panel = Frame(top, width=240)
        right_panel.pack(side=RIGHT, fill=Y)
        Label(right_panel, text="Fix Runner").pack(anchor="w")

        simple_panel = Frame(right_panel)
        simple_panel.pack(fill=X, pady=(2, 0))
        Button(
            simple_panel,
            text="Start Here (Checklist + Env Setup)",
            command=self.start_here_fix_and_checklist,
        ).pack(fill=X, pady=(0, 6))
        Button(
            simple_panel,
            text="Fix Lovable Automatically",
            command=self.auto_fix_all_lovable,
        ).pack(fill=X, pady=(0, 6))

        self._show_advanced_var = IntVar(value=0)
        Checkbutton(
            simple_panel,
            text="Show advanced tools",
            variable=self._show_advanced_var,
            command=self._toggle_advanced_tools,
        ).pack(anchor="w", pady=(0, 6))

        self._advanced_panel = Frame(right_panel)

        Button(self._advanced_panel, text="Scan Project", command=lambda: self.run_core_action("scan project")).pack(
            fill=X, pady=2
        )
        Button(self._advanced_panel, text="View Matches", command=self.view_matches).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Continue Fix", command=self.continue_fix_mode).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Auto Fix Lovable", command=self.auto_fix_lovable).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Auto Fix All (Lovable)", command=self.auto_fix_all_lovable).pack(fill=X, pady=2)
        Button(
            self._advanced_panel,
            text="Check AI Provider Routing",
            command=self.check_ai_provider_routing,
        ).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Check Etsy OAuth", command=self.check_etsy_oauth).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Find Etsy Redirect URI", command=self.check_etsy_redirect).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Open Shopify", command=lambda: self.run_core_action("open shopify")).pack(
            fill=X, pady=2
        )

        Label(self._advanced_panel, text="Patch Workflow").pack(anchor="w", pady=(10, 0))
        Button(self._advanced_panel, text="Inspect Selected File", command=self.inspect_selected_file).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Draft Patch", command=self.draft_patch).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Show Diff", command=self.show_diff).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Apply Patch", command=self.apply_patch).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Skip File", command=self.skip_match).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Next Candidate", command=self.next_candidate).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Open Last Backup", command=self.open_last_backup_folder).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Git Status", command=lambda: self.run_repo_cmd("git status")).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Git Diff", command=lambda: self.run_repo_cmd("git diff")).pack(fill=X, pady=2)
        Button(
            self._advanced_panel,
            text="Continue Last Fix",
            command=lambda: self.run_core_action("continue last fix"),
        ).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Open Repo", command=lambda: self.run_core_action("open repo")).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Open Website", command=lambda: self.run_core_action("open website")).pack(
            fill=X, pady=2
        )
        Button(
            self._advanced_panel,
            text="Add Goal -> Plan",
            command=self.add_goal_prompt,
        ).pack(fill=X, pady=(10, 2))
        Button(
            self._advanced_panel,
            text="Setup Project",
            command=self.setup_project_wizard,
        ).pack(fill=X, pady=2)
        Button(self._advanced_panel, text="Settings", command=self.open_settings_window).pack(fill=X, pady=2)

        Label(self._advanced_panel, text="Session Log").pack(anchor="w", pady=(10, 0))
        self.session_log = Text(self._advanced_panel, wrap="word", height=10, width=30)
        self.session_log.pack(fill=BOTH, expand=True, pady=(2, 0))
        Button(self._advanced_panel, text="Open Log File", command=self.open_log_file).pack(fill=X, pady=(6, 0))

        self._toggle_advanced_tools()

        self.output = Text(main, wrap="word", height=14)
        self.output.pack(fill=BOTH, expand=True, padx=10, pady=(6, 6))
        self.output.insert(END, f"{APP_NAME} v{APP_VERSION} is ready. Type help for ideas.\n\n")

        input_frame = Frame(main)
        input_frame.pack(side=TOP, fill=X, padx=10)

        self.command_var = StringVar()
        self.entry = Entry(input_frame, textvariable=self.command_var)
        self.entry.pack(side=LEFT, fill=X, expand=True)
        self.entry.bind("<Return>", self.run_command)

        Button(input_frame, text="Run", command=self.run_command).pack(side=LEFT, padx=6)

        tasks_frame = Frame(main)
        tasks_frame.pack(side=BOTTOM, fill=BOTH, expand=True, padx=10, pady=(6, 10))

        Label(tasks_frame, text="Tasks").pack(anchor="w")

        list_frame = Frame(tasks_frame)
        list_frame.pack(fill=BOTH, expand=True)

        scrollbar = Scrollbar(list_frame)
        scrollbar.pack(side=RIGHT, fill=Y)

        self.task_list = Listbox(list_frame, selectmode=SINGLE, yscrollcommand=scrollbar.set)
        self.task_list.pack(side=LEFT, fill=BOTH, expand=True)
        self.task_list.bind("<Double-Button-1>", lambda _event: self.toggle_selected_task())
        scrollbar.config(command=self.task_list.yview)

        button_frame = Frame(tasks_frame)
        button_frame.pack(fill=X, pady=8)
        Button(button_frame, text="Toggle Task", command=self.toggle_selected_task).pack(side=LEFT, padx=4)
        Button(button_frame, text="Delete Task", command=self.delete_selected_task).pack(side=LEFT, padx=4)
        Button(button_frame, text="Quick Open Folder", command=self.pick_and_open_folder).pack(side=LEFT, padx=4)

        self.refresh_projects()
        self.refresh_project_details()
        self.refresh_tasks()

    def _toggle_advanced_tools(self):
        show = bool(self._show_advanced_var.get())
        if show:
            self._advanced_panel.pack(fill=BOTH, expand=True, pady=(0, 0))
        else:
            try:
                self._advanced_panel.pack_forget()
            except Exception:
                pass

    def start_here_fix_and_checklist(self):
        project = self.core.active_project() or {}
        repo_path = (project.get("repo_path") or "").strip()
        if not repo_path:
            messagebox.showinfo(APP_NAME, "Pick a repo folder first (Pick Repo).", parent=self.root)
            return

        repo_root = Path(repo_path)

        self.write_output("> start here")
        self.write_output("Use this button first. Advanced tools are optional.")
        self.write_output("Running preflight and generating a setup checklist...")
        self.log_event("Start Here launched")

        def worker():
            scan_summary = self.core.scan_active_project()
            preflight_text, missing_by_service = self.core.preflight_requirements()

            def on_done():
                self.write_output("Scan summary:")
                self.write_output(scan_summary)
                self.write_output("")
                # Allow user to ignore Shopify unless they truly need admin/private access.
                missing = dict(missing_by_service or {})
                if "Shopify" in missing:
                    keep = messagebox.askyesno(
                        APP_NAME,
                        "Shopify was detected.\n\nAre you actually connecting to Shopify (admin/private app actions)?\n"
                        "Yes = keep Shopify keys in the checklist.\n"
                        "No = ignore Shopify keys for now (public-only).",
                        parent=self.root,
                    )
                    if not keep:
                        missing.pop("Shopify", None)
                        project = self.core.active_project() or {}
                        opt_out = project.get("integration_opt_out")
                        if not isinstance(opt_out, list):
                            opt_out = []
                        if "Shopify" not in opt_out:
                            opt_out.append("Shopify")
                            project["integration_opt_out"] = opt_out
                            self.core.save_projects()
                        self.write_output("Ignoring Shopify keys for now.")

                checklist = self.core.build_setup_checklist(missing)
                self.write_output(preflight_text)
                self.write_output("")
                self.write_output(checklist)
                self.refresh_projects()
                self.refresh_project_details()

                write_files = messagebox.askyesno(
                    APP_NAME,
                    "Write the checklist to the repo and create/update env templates (keys only, no values)?",
                    parent=self.root,
                )
                if write_files:
                    msg = self.core.write_setup_checklist(repo_root, checklist)
                    self.write_output(msg)

                    keys = self.core.collect_required_keys(missing)
                    if keys:
                        template_values = {k: "" for k in keys}
                        preview = self.core.build_env_patch_preview(repo_root, template_values)
                        approved = messagebox.askyesno(
                            APP_NAME,
                            "Approve writing env templates (.env + .env.local) with required keys (blank values)?\n\nPreview:\n"
                            + preview[:1600]
                            + ("\n\n(Preview truncated)" if len(preview) > 1600 else ""),
                            parent=self.root,
                        )
                        if approved:
                            result = self.core.apply_env_patch(repo_root, template_values)
                            self.write_output(result)
                        else:
                            self.write_output("Skipped writing env templates.")

                run_wizard = messagebox.askyesno(
                    APP_NAME,
                    "Do you want to enter missing key values now (wizard prompts one by one)?",
                    parent=self.root,
                )
                if run_wizard:
                    # Re-run wizard based on current preflight (it will respect opt-outs).
                    self.setup_project_wizard()

            self.root.after(0, on_done)

        threading.Thread(target=worker, daemon=True).start()

    def _prompt_value(self, key_name: str, *, is_secret: bool) -> str | None:
        win = Toplevel(self.root)
        win.title(f"Setup: {key_name}")
        win.geometry("560x160")
        Label(win, text=f"Enter value for {key_name}:").pack(anchor="w", padx=10, pady=(12, 6))
        var = StringVar()
        entry = Entry(win, textvariable=var, width=80, show="*" if is_secret else None)
        entry.pack(fill=X, padx=10)
        entry.focus_set()

        result: dict[str, str | None] = {"value": None}

        def on_ok():
            result["value"] = var.get()
            win.destroy()

        def on_skip():
            result["value"] = None
            win.destroy()

        btns = Frame(win)
        btns.pack(fill=X, padx=10, pady=12)
        Button(btns, text="Skip", command=on_skip).pack(side=RIGHT, padx=4)
        Button(btns, text="Save", command=on_ok).pack(side=RIGHT, padx=4)

        win.transient(self.root)
        win.grab_set()
        self.root.wait_window(win)
        return result["value"]

    def setup_project_wizard(self):
        project = self.core.active_project() or {}
        repo_path = (project.get("repo_path") or "").strip()
        if not repo_path:
            messagebox.showinfo(APP_NAME, "Pick a repo folder first (Pick Repo).", parent=self.root)
            return

        text, missing_by_service = self.core.preflight_requirements()
        self.write_output(text)
        self.refresh_projects()
        self.refresh_project_details()

        if not missing_by_service:
            messagebox.showinfo(APP_NAME, "Preflight found no missing keys for detected integrations.", parent=self.root)
            return

        proceed = messagebox.askyesno(
            APP_NAME,
            "Preflight found missing keys.\n\nStart setup wizard to collect only the needed values and create/update .env files?",
            parent=self.root,
        )
        if not proceed:
            self.write_output("Setup wizard cancelled.")
            return

        keys_needed: list[str] = []
        for service, keys in missing_by_service.items():
            for k in keys:
                if k not in keys_needed:
                    keys_needed.append(k)

        secrets = {"SECRET", "TOKEN", "PASSWORD", "PRIVATE", "SERVICE_ROLE"}
        values: dict[str, str] = {}
        for key in keys_needed:
            is_secret = any(tag in key for tag in secrets) or key.endswith("_KEY") or key.endswith("_SECRET")
            val = self._prompt_value(key, is_secret=is_secret)
            if val is None:
                continue
            val = val.strip()
            if val:
                values[key] = val

        if not values:
            self.write_output("No values collected.")
            return

        # Build preview of file changes (permission gate).
        repo_root = Path(repo_path)
        preview = self.core.build_env_patch_preview(repo_root, values)
        approved = messagebox.askyesno(
            APP_NAME,
            "Approve writing these env changes?\n\nPreview:\n"
            + preview[:1600]
            + ("\n\n(Preview truncated)" if len(preview) > 1600 else ""),
            parent=self.root,
        )
        if not approved:
            self.write_output("Cancelled file write.")
            return

        result = self.core.apply_env_patch(repo_root, values)
        self.write_output(result)
        self.refresh_project_details()

    def log_event(self, text: str):
        stamp = datetime.now().strftime("%H:%M:%S")
        self.session_log.insert(END, f"[{stamp}] {text}\n")
        self.session_log.see(END)

    def _active_repo_root(self) -> Path | None:
        project = self.core.active_project() or {}
        repo_path = (project.get("repo_path") or "").strip()
        if not repo_path:
            return None
        root = Path(repo_path)
        if not root.exists() or not root.is_dir():
            return None
        return root

    def run_repo_cmd(self, cmd: str):
        cmd = (cmd or "").strip()
        if not cmd:
            return
        self.command_var.set(f"run {cmd}")
        self.run_command()

    def open_last_backup_folder(self):
        project = self.core.active_project() or {}
        backup_dir = (project.get("last_backup_dir") or "").strip()
        if backup_dir and Path(backup_dir).exists():
            err = self.core._popen(["explorer", backup_dir], use_shell=True)
            msg = "Opened last backup folder." if not err else f"Could not open backup folder: {err}"
            self.write_output(msg)
            self.log_event(msg)
            return
        # Fall back to backups root
        root = DATA_DIR / "backups"
        err = self.core._popen(["explorer", str(root)], use_shell=True)
        msg = "Opened backups folder." if not err else f"Could not open backups folder: {err}"
        self.write_output(msg)
        self.log_event(msg)

    def open_log_file(self):
        log_path = DATA_DIR / "phoenix_helper.log"
        if log_path.exists():
            err = self.core._popen(["explorer", str(log_path)], use_shell=True)
            msg = "Opened log file." if not err else f"Could not open log file: {err}"
            self.write_output(msg)
            self.log_event(msg)
            return
        msg = f"No log file found yet at {log_path}"
        self.write_output(msg)
        self.log_event(msg)

    def view_matches(self):
        self.write_output("> find lovable dependencies")
        self.write_output("Scanning for Lovable matches...")
        self.log_event("Scanning for Lovable matches")

        def worker():
            text, hits = self.core.find_lovable_matches()

            def on_done():
                self.write_output(text)
                self.matches = hits
                self.matches_list.delete(0, END)
                for h in hits[:200]:
                    label = f"[{h.category}] {h.score} {h.path}:{h.line_no} {h.line}"
                    if len(label) > 180:
                        label = label[:177] + "..."
                    self.matches_list.insert(END, label)
                if hits:
                    self.matches_list.selection_set(0)
                    self.matches_list.activate(0)
                self.refresh_projects()
                self.refresh_project_details()
                self.log_event(f"Found {len(hits)} Lovable match hit(s)")

            self.root.after(0, on_done)

        threading.Thread(target=worker, daemon=True).start()

    def _render_matches(self, hits: list[MatchHit], *, select_index: int | None = None):
        self.matches = hits
        self.matches_list.delete(0, END)
        for h in hits[:200]:
            label = f"[{h.category}] {h.score} {h.path}:{h.line_no} {h.line}"
            if len(label) > 180:
                label = label[:177] + "..."
            self.matches_list.insert(END, label)

        if hits:
            idx = 0 if select_index is None else max(0, min(select_index, len(hits) - 1))
            self.matches_list.selection_clear(0, END)
            self.matches_list.selection_set(idx)
            self.matches_list.activate(idx)
            self.matches_list.see(idx)
            self.selected_match_index = idx
        else:
            self.selected_match_index = None

    def get_selected_match(self) -> MatchHit | None:
        idx = self.selected_match_index
        if idx is None:
            sel = self.matches_list.curselection()
            if not sel:
                return None
            idx = int(sel[0])
        if idx < 0 or idx >= len(self.matches):
            return None
        return self.matches[idx]

    def _on_match_select(self):
        sel = self.matches_list.curselection()
        if not sel:
            self.selected_match_index = None
            return
        self.selected_match_index = int(sel[0])

    def next_candidate(self):
        if not self.matches:
            messagebox.showinfo(APP_NAME, "No matches loaded yet. Click View Matches.", parent=self.root)
            return
        idx = self.selected_match_index if self.selected_match_index is not None else 0
        idx = min(idx + 1, len(self.matches) - 1)
        self.matches_list.selection_clear(0, END)
        self.matches_list.selection_set(idx)
        self.matches_list.activate(idx)
        self.selected_match_index = idx
        self.matches_list.see(idx)
        hit = self.matches[idx]
        self.log_event(f"Moved to next candidate {hit.path}:{hit.line_no}")

    def inspect_selected_file(self):
        hit = self.get_selected_match()
        root = self._active_repo_root()
        if not hit or not root:
            messagebox.showinfo(APP_NAME, "Select a match first (View Matches).", parent=self.root)
            return

        target = root / hit.path
        text = _safe_read_text(target, max_bytes=3_000_000)
        if not text:
            messagebox.showerror(APP_NAME, f"Could not read file: {target}", parent=self.root)
            return

        lines = text.splitlines()
        start = max(0, hit.line_no - 15)
        end = min(len(lines), hit.line_no + 15)
        snippet = []
        for i in range(start, end):
            prefix = ">>" if (i + 1) == hit.line_no else "  "
            snippet.append(f"{prefix} {i+1:4d}: {lines[i]}")

        win = Toplevel(self.root)
        win.title(f"Inspect: {hit.path}")
        win.geometry("900x600")
        t = Text(win, wrap="none")
        t.pack(fill=BOTH, expand=True)
        t.insert(END, "\n".join(snippet))
        t.see(END)
        self.log_event(f"Inspected {hit.path}:{hit.line_no}")

    def draft_patch(self):
        hit = self.get_selected_match()
        repo_root = self._active_repo_root()
        if not hit or not repo_root:
            messagebox.showinfo(APP_NAME, "Select a match first (View Matches).", parent=self.root)
            return

        self.write_output(f"> draft patch for {hit.path}:{hit.line_no}")
        self.log_event(f"Draft patch requested for {hit.path}")

        def worker():
            msg, changes, diff_text = self.core.draft_lovable_patch(repo_root, hit)

            def on_done():
                self.draft_changes = changes
                self.draft_diff = diff_text
                self.write_output(msg)
                if diff_text:
                    self.write_output("Diff ready: click Show Diff.")
                self.log_event(msg)

            self.root.after(0, on_done)

        threading.Thread(target=worker, daemon=True).start()

    def show_diff(self):
        if not self.draft_diff:
            messagebox.showinfo(APP_NAME, "No diff yet. Click Draft Patch first.", parent=self.root)
            return
        win = Toplevel(self.root)
        win.title("Diff Preview")
        win.geometry("1000x700")
        t = Text(win, wrap="none")
        t.pack(fill=BOTH, expand=True)
        t.insert(END, self.draft_diff)
        t.see("1.0")
        self.log_event("Viewed diff")

    def apply_patch(self):
        repo_root = self._active_repo_root()
        if not repo_root:
            messagebox.showinfo(APP_NAME, "Pick a repo folder first (Pick Repo).", parent=self.root)
            return
        if not self.draft_changes:
            messagebox.showinfo(APP_NAME, "No drafted patch. Click Draft Patch first.", parent=self.root)
            return

        approved = messagebox.askyesno(
            APP_NAME,
            "Apply this patch?\n\n- A backup copy will be saved first\n- Files will be edited on disk\n\nContinue?",
            parent=self.root,
        )
        if not approved:
            self.write_output("Cancelled patch apply.")
            self.log_event("Cancelled patch apply")
            return

        result = self.core.apply_file_changes_with_backup(repo_root, self.draft_changes)
        self.write_output(result)
        self.log_event("Applied patch and created backup")
        # Clear draft after apply
        self.draft_changes = []
        self.draft_diff = ""

    def skip_match(self):
        sel = self.matches_list.curselection()
        if not sel:
            return
        idx = int(sel[0])
        hit = self.get_selected_match()
        if hit:
            self.log_event(f"Skipped {hit.path}:{hit.line_no}")
        try:
            self.matches.pop(idx)
        except Exception:
            return
        self.matches_list.delete(idx)
        if self.matches:
            new_idx = min(idx, len(self.matches) - 1)
            self.matches_list.selection_set(new_idx)
            self.matches_list.activate(new_idx)
            self.selected_match_index = new_idx
        else:
            self.selected_match_index = None

    def auto_fix_lovable(self):
        repo_root = self._active_repo_root()
        if not repo_root:
            messagebox.showinfo(APP_NAME, "Pick a repo folder first (Pick Repo).", parent=self.root)
            return

        self.write_output("> auto fix lovable")
        self.write_output("Hands-free mode: finding best candidate and drafting a patch...")
        self.log_event("Auto Fix Lovable started")

        def worker():
            try:
                _text, hits = self.core.find_lovable_matches()
            except Exception as e:
                def on_err():
                    self.write_output(f"Auto Fix failed during match scan: {e}")
                    self.log_event(f"Auto Fix scan error: {e}")
                self.root.after(0, on_err)
                return

            chosen_idx = None
            chosen_changes: list[dict] = []
            chosen_diff = ""
            chosen_msg = "No patch drafted."

            # Prefer actionable candidates (non-noise, non-lockfile, likely routes) first.
            actionable = [h for h in hits if h.category != "noise"]
            max_candidates = min(60, len(actionable))
            for i, hit in enumerate(actionable[:max_candidates], start=1):
                if i <= 8 or i % 5 == 0:
                    self.root.after(
                        0,
                        lambda i=i, max_candidates=max_candidates, hit=hit: self.log_event(
                            f"Auto Fix: trying candidate {i}/{max_candidates} {hit.path}:{hit.line_no}"
                        ),
                    )
                try:
                    msg, changes, diff_text = self.core.draft_lovable_patch(repo_root, hit)
                except Exception as e:
                    self.root.after(0, lambda e=e, hit=hit: self.log_event(f"Draft failed for {hit.path}: {e}"))
                    continue
                if changes and diff_text:
                    chosen_idx = i - 1
                    chosen_changes = changes
                    chosen_diff = diff_text
                    chosen_msg = msg
                    break

            def on_done():
                self._render_matches(hits, select_index=chosen_idx or 0)

                if chosen_idx is None:
                    self.write_output(f"Auto Fix scan results: {len(hits)} Lovable match(es) found.")
                    if hits:
                        self.write_output("Top candidates (inspect these if needed):")
                        for h in hits[:5]:
                            self.write_output(f"- {h.path}:{h.line_no} ({h.term})")
                    self.write_output("Auto Fix could not draft a safe patch automatically.")
                    self.write_output(
                        "Next: click Inspect Selected File on the top match and we'll draft a targeted fix.\n"
                        "Tip: click View Matches again if you previously applied patches (backup copies are ignored now)."
                    )
                    self.log_event("Auto Fix Lovable: no safe patch drafted")
                    return

                self.draft_changes = chosen_changes
                self.draft_diff = chosen_diff
                self.write_output(chosen_msg)
                self.log_event(f"Auto Fix drafted patch for candidate #{chosen_idx + 1}")

                # Ask before opening a potentially large diff window.
                self.log_event("Waiting for approval popup (Show diff)")
                ask_show = messagebox.askyesno(APP_NAME, "Draft patch ready. Show diff now?", parent=self.root)
                if ask_show:
                    self.show_diff()

                self.log_event("Waiting for approval popup (Apply patch)")
                ask = messagebox.askyesno(
                    APP_NAME, "Apply this patch now? A backup will be created first.", parent=self.root
                )
                if ask:
                    self.apply_patch()

            self.root.after(0, on_done)

        threading.Thread(target=worker, daemon=True).start()

    def continue_fix_mode(self):
        # Prefer hands-free; stop to ask permission before applying.
        self.auto_fix_lovable()

    def auto_fix_all_lovable(self):
        if self._auto_fix_active:
            messagebox.showinfo(APP_NAME, "Auto Fix All is already running.", parent=self.root)
            return
        repo_root = self._active_repo_root()
        if not repo_root:
            messagebox.showinfo(APP_NAME, "Pick a repo folder first (Pick Repo).", parent=self.root)
            return
        go = messagebox.askyesno(
            APP_NAME,
            "Auto Fix All will keep drafting/applying Lovable removal patches until no more safe fixes are found.\n\n"
            "It will still ask permission before each apply. Continue?",
            parent=self.root,
        )
        if not go:
            return
        self._auto_fix_active = True
        self._auto_fix_tried = set()
        self._auto_fix_applied = 0
        self.write_output("> auto fix all lovable")
        self.log_event("Auto Fix All started")
        self._auto_fix_all_step()

    def _auto_fix_all_step(self):
        if not self._auto_fix_active:
            return
        if self._auto_fix_applied >= self._auto_fix_max:
            self.write_output(f"Auto Fix All stopped after {self._auto_fix_applied} applied patch(es).")
            self.log_event("Auto Fix All hit max patches")
            self._auto_fix_active = False
            return

        repo_root = self._active_repo_root()
        if not repo_root:
            self.write_output("Auto Fix All stopped: repo path not set.")
            self._auto_fix_active = False
            return

        def worker():
            _text, hits = self.core.find_lovable_matches()
            chosen_idx = None
            chosen_changes: list[dict] = []
            chosen_diff = ""
            chosen_msg = ""

            actionable = [h for h in hits if h.category != "noise"]
            for idx, hit in enumerate(actionable[:120]):
                key = f"{hit.path}:{hit.line_no}:{hit.term}"
                if key in self._auto_fix_tried:
                    continue
                self._auto_fix_tried.add(key)
                msg, changes, diff_text = self.core.draft_lovable_patch(repo_root, hit)
                if changes and diff_text:
                    # Map back to the real hits index so selection lines up.
                    try:
                        chosen_idx = hits.index(hit)
                    except ValueError:
                        chosen_idx = 0
                    chosen_changes = changes
                    chosen_diff = diff_text
                    chosen_msg = msg
                    break

            def on_done():
                self.write_output(f"Auto Fix All scan results: {len(hits)} Lovable match(es) found.")
                self._render_matches(hits, select_index=chosen_idx or 0)
                if chosen_idx is None:
                    self.write_output("Auto Fix All: no more safe patches found.")
                    if hits:
                        self.write_output("Top remaining candidates:")
                        for h in hits[:5]:
                            self.write_output(f"- {h.path}:{h.line_no} ({h.term})")
                    self.log_event("Auto Fix All completed (no more patches)")
                    self._auto_fix_active = False
                    return

                self.draft_changes = chosen_changes
                self.draft_diff = chosen_diff
                self.write_output(chosen_msg)
                self.log_event(f"Auto Fix All drafted patch #{self._auto_fix_applied + 1}")

                self.log_event("Waiting for approval popup (Show diff)")
                ask_show = messagebox.askyesno(APP_NAME, "Draft patch ready. Show diff now?", parent=self.root)
                if ask_show:
                    self.show_diff()

                self.log_event("Waiting for approval popup (Apply patch)")
                ask_apply = messagebox.askyesno(
                    APP_NAME, "Apply this patch now? A backup will be created first.", parent=self.root
                )
                if not ask_apply:
                    self.write_output("Auto Fix All paused (apply cancelled).")
                    self.log_event("Auto Fix All paused by user")
                    self._auto_fix_active = False
                    return

                result = self.core.apply_file_changes_with_backup(repo_root, self.draft_changes)
                self.write_output(result)
                self.log_event("Applied patch")
                self.draft_changes = []
                self.draft_diff = ""
                self._auto_fix_applied += 1

                # Continue automatically to the next fix.
                self.root.after(200, self._auto_fix_all_step)

            self.root.after(0, on_done)

        threading.Thread(target=worker, daemon=True).start()

    def check_ai_provider_routing(self):
        repo_root = self._active_repo_root()
        if not repo_root:
            messagebox.showinfo(APP_NAME, "Pick a repo folder first (Pick Repo).", parent=self.root)
            return

        self.write_output("> check ai provider routing")
        self.write_output("Scanning for AI routing + Lovable lock-in...")
        self.log_event("AI routing check started")

        def worker():
            preflight_text, missing = self.core.preflight_requirements()
            lovable_text, hits = self.core.find_lovable_matches()

            ai_candidates = [h for h in hits if "ai" in h.category.lower() or "provider" in h.category.lower()]
            lines = []
            lines.append("AI Provider Routing Check")
            lines.append("")
            lines.append(preflight_text)
            lines.append("")
            if ai_candidates:
                lines.append("Likely AI/provider entry points (ranked):")
                for h in ai_candidates[:8]:
                    lines.append(f"- score={h.score} {h.path}:{h.line_no}  {h.line}")
                    lines.append(f"  why: {h.reason}")
            else:
                lines.append("No obvious AI/provider entry point found. Try Scan Project + inspect AI-related files.")

            if missing:
                lines.append("")
                lines.append("Missing env vars (from preflight):")
                for svc, keys in missing.items():
                    lines.append(f"- {svc}: " + ", ".join(keys))

            def on_done():
                self.write_output("\n".join(lines))
                self.matches = hits
                self.matches_list.delete(0, END)
                for h in hits[:200]:
                    label = f"[{h.category}] {h.score} {h.path}:{h.line_no} {h.line}"
                    if len(label) > 180:
                        label = label[:177] + "..."
                    self.matches_list.insert(END, label)
                self.log_event("AI routing check complete")

            self.root.after(0, on_done)

        threading.Thread(target=worker, daemon=True).start()

    def check_etsy_oauth(self):
        repo_root = self._active_repo_root()
        if not repo_root:
            messagebox.showinfo(APP_NAME, "Pick a repo folder first (Pick Repo).", parent=self.root)
            return
        self.write_output("> check etsy oauth")
        self.write_output("Scanning for Etsy OAuth routes and token handling...")
        self.log_event("Etsy OAuth check started")

        def worker():
            text, hits = self.core.find_etsy_oauth_matches()

            def on_done():
                self.write_output(text)
                # Show oauth matches in the same list for inspection
                self.matches = hits
                self.matches_list.delete(0, END)
                for h in hits[:200]:
                    label = f"[{h.category}] {h.score} {h.path}:{h.line_no} {h.line}"
                    if len(label) > 180:
                        label = label[:177] + "..."
                    self.matches_list.insert(END, label)
                if hits:
                    self.matches_list.selection_set(0)
                    self.matches_list.activate(0)
                self.log_event(f"Etsy OAuth hits: {len(hits)}")

            self.root.after(0, on_done)

        threading.Thread(target=worker, daemon=True).start()

    def check_etsy_redirect(self):
        repo_root = self._active_repo_root()
        if not repo_root:
            messagebox.showinfo(APP_NAME, "Pick a repo folder first (Pick Repo).", parent=self.root)
            return
        self.write_output("> find etsy redirect")
        self.write_output("Scanning for likely redirect_uri lines...")
        self.log_event("Etsy redirect scan started")

        def worker():
            text, hits = self.core.find_etsy_redirect_uris()

            def on_done():
                self.write_output(text)
                self._render_matches(hits, select_index=0)
                self.log_event(f"Etsy redirect hits: {len(hits)}")

            self.root.after(0, on_done)

        threading.Thread(target=worker, daemon=True).start()

    def write_output(self, text: str):
        self.output.insert(END, text + "\n\n")
        self.output.see(END)

    def refresh_projects(self):
        self.project_list.delete(0, END)
        active_id = (self.core.active_project() or {}).get("id")
        active_index = 0
        for i, project in enumerate(self.core.projects, start=0):
            name = (project.get("name") or f"App {i+1}").strip()
            domain = (project.get("domain_name") or "").strip()
            framework = (project.get("framework") or "").strip()
            parts = [name]
            if domain:
                parts.append(domain)
            if framework:
                parts.append(framework)
            label = " | ".join(parts)
            if project.get("id") == active_id:
                label = "* " + label
                active_index = i
            self.project_list.insert(END, label)
        if self.core.projects:
            try:
                self.project_list.selection_clear(0, END)
                self.project_list.selection_set(active_index)
                self.project_list.activate(active_index)
            except Exception:
                pass

    def on_project_select(self, _event=None):
        sel = self.project_list.curselection()
        if not sel:
            return
        idx = int(sel[0])
        if 0 <= idx < len(self.core.projects):
            project_id = (self.core.projects[idx].get("id") or "").strip()
            if project_id:
                self.core._set_active_project(project_id)
                self.refresh_projects()
                self.refresh_project_details()

    def refresh_project_details(self):
        project = self.core.active_project() or {}
        lines = []
        lines.append(f"Name: {(project.get('name') or '').strip() or '(unnamed)'}")
        repo = (project.get("repo_path") or "").strip()
        if repo:
            lines.append(f"Repo: {repo}")
        domain = (project.get("domain_name") or "").strip()
        if domain:
            lines.append(f"Domain: {domain}")
        framework = (project.get("framework") or "").strip()
        if framework:
            lines.append(f"Framework: {framework}")
        last_scan = (project.get("last_scanned_at") or "").strip()
        if last_scan:
            lines.append(f"Last scan: {last_scan}")
        blockers = project.get("blockers")
        if isinstance(blockers, list) and blockers:
            lines.append("")
            lines.append("Blockers:")
            for b in blockers[:8]:
                lines.append(f"- {b}")
        next_action = (project.get("next_action") or "").strip()
        if next_action:
            lines.append("")
            lines.append("Next action:")
            lines.append(f"- {next_action}")

        text = "\n".join(lines).strip() + "\n"
        self.details.delete("1.0", END)
        self.details.insert(END, text)

    def add_project_prompt(self):
        name = simpledialog.askstring(APP_NAME, "Project name (example: IronPhoenixFlow):")
        if not name:
            return
        self.write_output(self.core.add_app(name))
        self.refresh_projects()
        self.refresh_project_details()

    def pick_repo_for_active(self):
        project = self.core.active_project() or {}
        initial = (project.get("repo_path") or self.core.settings.get("default_project_folder") or str(Path.home())).strip()
        folder = filedialog.askdirectory(initialdir=initial)
        if not folder:
            return
        self.write_output(self.core.set_app_field("repo_path", folder))
        self.refresh_project_details()

    def run_core_action(self, command: str):
        self.write_output(f"> {command}")
        self.write_output("Working...")

        def worker():
            result = self.core.handle_command(command)
            self.root.after(
                0,
                lambda: (
                    self.write_output(result),
                    self.refresh_projects(),
                    self.refresh_project_details(),
                    self.refresh_tasks(),
                ),
            )

        threading.Thread(target=worker, daemon=True).start()

    def add_goal_prompt(self):
        goal = simpledialog.askstring(APP_NAME, "What is the goal? (example: move IronPhoenixFlow off Lovable today)")
        if not goal:
            return
        self.write_output(f"> goal: {goal}")
        plan = self.core.plan_for_goal(goal)
        if not plan:
            self.write_output("I couldn’t auto-plan that yet. Try: scan project")
            return
        for item in plan:
            self.core.add_task(item)
        self.write_output("Created tasks:\n" + "\n".join([f"- {p}" for p in plan]))
        self.refresh_tasks()

    def run_command(self, event=None):
        command = self.command_var.get().strip()
        self.command_var.set("")
        if not command:
            return
        self.write_output(f"> {command}")
        lower = command.lower().strip()
        if lower == "ai" or lower.startswith("ai "):
            self.write_output("Thinking...")

            def worker():
                result = self.core.handle_command(command)
                self.root.after(
                    0,
                    lambda: (
                        self.write_output(result),
                        self.refresh_tasks(),
                    ),
                )

            threading.Thread(target=worker, daemon=True).start()
            return

        if lower.startswith("run "):
            cmd = command[4:].strip()
            if not cmd:
                self.write_output("Usage: run <command>")
                return

            project = self.core.active_project() or {}
            repo_path = (project.get("repo_path") or "").strip()
            if not repo_path:
                self.write_output("No repo_path set for this app. Set it with: set app repo_path C:\\Code\\YourRepo")
                return

            approved = messagebox.askyesno(
                APP_NAME,
                f"Approve running this command in:\n{repo_path}\n\n{cmd}\n\nThis may modify files.",
                parent=self.root,
            )
            if not approved:
                self.write_output("Cancelled.")
                return

            self.write_output("Running...")

            def worker_run():
                try:
                    result = subprocess.run(
                        cmd,
                        cwd=repo_path,
                        shell=True,
                        capture_output=True,
                        text=True,
                    )
                    out = (result.stdout or "").strip()
                    err = (result.stderr or "").strip()
                    code = result.returncode
                    text_out = []
                    text_out.append(f"Exit code: {code}")
                    if out:
                        text_out.append("\nSTDOUT:\n" + out)
                    if err:
                        text_out.append("\nSTDERR:\n" + err)
                    final = "\n".join(text_out).strip()
                except Exception as e:
                    final = f"Command failed: {e}"

                self.root.after(0, lambda: (self.write_output(final), self.refresh_tasks()))

            threading.Thread(target=worker_run, daemon=True).start()
            return

        result = self.core.handle_command(command)
        self.write_output(result)
        self.refresh_projects()
        self.refresh_project_details()
        self.refresh_tasks()

    def refresh_tasks(self):
        self.task_list.delete(0, END)
        for task in self.core.tasks:
            mark = "[x]" if task.done else "[ ]"
            self.task_list.insert(END, f"{mark} {task.title}")

    def get_selected_index(self):
        selected = self.task_list.curselection()
        if not selected:
            messagebox.showinfo(APP_NAME, "Pick a task first.", parent=self.root)
            return None
        return selected[0]

    def toggle_selected_task(self):
        idx = self.get_selected_index()
        if idx is None:
            return
        self.write_output(self.core.toggle_task(idx))
        self.refresh_tasks()

    def delete_selected_task(self):
        idx = self.get_selected_index()
        if idx is None:
            return
        self.write_output(self.core.remove_task(idx))
        self.refresh_tasks()

    def pick_and_open_folder(self):
        folder = filedialog.askdirectory(initialdir=self.core.settings.get("default_project_folder", str(Path.home())))
        if folder:
            self.write_output(self.core.open_project_folder(folder))

    def open_settings_window(self):
        win = Toplevel(self.root)
        win.title("Settings")
        win.geometry("720x520")

        fields = {
            "user_name": StringVar(value=self.core.settings.get("user_name", "")),
            "smtp_server": StringVar(value=self.core.settings.get("smtp_server", "smtp.gmail.com")),
            "smtp_port": StringVar(value=str(self.core.settings.get("smtp_port", 587))),
            "smtp_email": StringVar(value=self.core.settings.get("smtp_email", "")),
            "smtp_password": StringVar(value=self.core.settings.get("smtp_password", "")),
            "openai_api_key": StringVar(value=self.core.settings.get("openai_api_key", "")),
            "openai_model": StringVar(value=self.core.settings.get("openai_model", "gpt-5-mini")),
            "shopify_admin_url": StringVar(value=self.core.settings.get("shopify_admin_url", "")),
            "default_project_folder": StringVar(value=self.core.settings.get("default_project_folder", str(Path.home()))),
            "domain_name": StringVar(value=(self.core.active_project() or {}).get("domain_name", "")),
            "current_host": StringVar(value=(self.core.active_project() or {}).get("current_host", "")),
            "target_host": StringVar(value=(self.core.active_project() or {}).get("target_host", "")),
            "pages_url": StringVar(value=(self.core.active_project() or {}).get("pages_url", "")),
            "worker_url": StringVar(value=(self.core.active_project() or {}).get("worker_url", "")),
            "supabase_url": StringVar(value=(self.core.active_project() or {}).get("supabase_url", "")),
            "registrar_url": StringVar(value=(self.core.active_project() or {}).get("registrar_url", "")),
            "dns_provider_url": StringVar(value=(self.core.active_project() or {}).get("dns_provider_url", "")),
            "hosting_dashboard_url": StringVar(value=(self.core.active_project() or {}).get("hosting_dashboard_url", "")),
        }

        def add_row(row: int, key: str, var: StringVar):
            Label(win, text=key.replace("_", " ").title()).grid(row=row, column=0, sticky="w", padx=8, pady=6)
            show = "*" if ("password" in key or key.endswith("_api_key")) else None
            Entry(win, textvariable=var, width=70, show=show).grid(row=row, column=1, padx=8, pady=6, sticky="we")

        win.grid_columnconfigure(1, weight=1)

        row = 0
        for key, var in fields.items():
            add_row(row, key, var)
            row += 1

        def choose_default_folder():
            folder = filedialog.askdirectory(initialdir=fields["default_project_folder"].get() or str(Path.home()))
            if folder:
                fields["default_project_folder"].set(folder)

        Button(win, text="Pick Default Folder", command=choose_default_folder).grid(
            row=row, column=0, sticky="w", padx=8, pady=10
        )

        def save_settings():
            payload = {k: v.get() for k, v in fields.items()}
            try:
                payload["smtp_port"] = int(payload["smtp_port"])
            except ValueError:
                messagebox.showerror(APP_NAME, "SMTP port must be a number.", parent=win)
                return
            self.write_output(self.core.save_settings_from_form(payload))
            win.destroy()

        Button(win, text="Save", command=save_settings).grid(row=row, column=1, sticky="e", padx=8, pady=10)

    def welcome_tips(self):
        self.write_output(
            "Easy start:\n"
            "1. Add your apps: `add app App1` (repeat for all 4).\n"
            "2. Switch apps: `list apps` then `use app 2`.\n"
            "3. Set the domain/host: `set app domain_name ironphoenixflow.com` + `set app target_host vercel`.\n"
            "4. Use `transition checklist` and `dns check` during cutover.\n"
            "5. Set a repo path then `open repo` to jump into coding."
        )


def main():
    def _sys_hook(exc_type, exc, tb):
        try:
            _log_unhandled("sys", exc if isinstance(exc, BaseException) else Exception(str(exc)))
        except Exception:
            pass
        try:
            messagebox.showerror(
                APP_NAME,
                f"Phoenix Helper crashed.\n\n{exc}\n\nA log file was written to:\n{DATA_DIR / 'phoenix_helper.log'}",
            )
        except Exception:
            pass

    sys.excepthook = _sys_hook
    try:
        def _thread_hook(args):
            try:
                _log_unhandled("thread", args.exc_value)
            except Exception:
                pass
        threading.excepthook = _thread_hook  # type: ignore[attr-defined]
    except Exception:
        pass

    root = Tk()
    app = AssistantUI(root)
    app.welcome_tips()
    root.mainloop()


if __name__ == "__main__":
    main()
0
