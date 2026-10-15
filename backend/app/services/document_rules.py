"""Document rules shared by every upload: categories, file types, visibilities, the role capability table, file-name tidying and CONTENT validation.

This is the enforcement point. The browser checks files too (for quick feedback), but nothing it says is trusted: the extension must be allowed, the declared type must agree
with it, the signature of the real bytes must match, and empty / truncated / corrupt files, executables, macros and active content are refused.
"""
import re
import unicodedata
import zipfile
from dataclasses import dataclass
from io import BytesIO

# ---- categories ---------------------------------------------------------------------------------------------------------
DEFAULT_CATEGORY_NAMES = ["Contracts", "Agreements", "Proposals", "Quotations", "Sales Orders", "Invoices", "Receipts", "Bills & Vendor Invoices", "HR Documents", "Project Documents",
                          "Customer Documents", "KYC / Business Documents", "Technical Documents", "Legal Documents", "Internal Documents", "Reports", "Other"]


def slug(value: str) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(value).lower()))


DEFAULT_CATEGORIES = [{"id": f"CAT-{slug(n)}", "name": n, "active": True, "system": n == "Other"} for n in DEFAULT_CATEGORY_NAMES]

# ---- file types ---------------------------------------------------------------------------------------------------------
FILE_TYPES = {
    "pdf": {"mimes": ["application/pdf"], "family": "pdf"},
    "doc": {"mimes": ["application/msword"], "family": "word"},
    "docx": {"mimes": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], "family": "word"},
    "xls": {"mimes": ["application/vnd.ms-excel"], "family": "excel"},
    "xlsx": {"mimes": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], "family": "excel"},
    "csv": {"mimes": ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"], "family": "excel"},
    "ppt": {"mimes": ["application/vnd.ms-powerpoint"], "family": "slides"},
    "pptx": {"mimes": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], "family": "slides"},
    "jpg": {"mimes": ["image/jpeg"], "family": "image"},
    "jpeg": {"mimes": ["image/jpeg"], "family": "image"},
    "png": {"mimes": ["image/png"], "family": "image"},
    "webp": {"mimes": ["image/webp"], "family": "image"},
}
ALL_EXTENSIONS = list(FILE_TYPES)
VISIBILITIES = ["Private", "Assigned User", "Team", "Department", "Related CRM Users", "Organization", "Confidential"]
DOC_STATUSES = ["Active", "Archived", "Deleted"]

DEFAULT_DOC_CONFIG = {
    "categories": DEFAULT_CATEGORIES,
    "allowedExtensions": list(ALL_EXTENSIONS),
    "maxSizeMb": 10,
    "maxFilesPerUpload": 10,
    "retentionDays": 30,
    "defaultVisibility": "Related CRM Users",
    "maxVersions": 50,
    "reviewWarnDays": 14,
    "shareMaxDays": 90,
}

# ---- who may do what ----------------------------------------------------------------------------------------------------
DOC_PERMISSION_KEYS = ["view", "upload", "editDetails", "download", "preview", "replace", "delete", "share", "createFolders", "manageCategories", "manageVersions", "viewConfidential",
                       "viewTeam", "viewDepartment", "viewAll"]
_ALL = list(DOC_PERMISSION_KEYS)
_OVERSIGHT = ["view", "preview", "download", "viewConfidential", "viewTeam", "viewDepartment", "viewAll"]
DOC_ROLE_CAPS = {
    "Super Admin": _ALL,
    "Admin": _ALL,
    "MD": _OVERSIGHT,
    "CEO": _OVERSIGHT,
    "Sales Manager": ["view", "upload", "editDetails", "download", "preview", "replace", "delete", "share", "createFolders", "manageVersions", "viewTeam", "viewDepartment"],
    "Sales Executive": ["view", "upload", "editDetails", "download", "preview", "replace"],
    "Project Manager": ["view", "upload", "editDetails", "download", "preview", "replace", "share", "createFolders", "manageVersions", "viewTeam", "viewDepartment"],
    "Project Staff": ["view", "upload", "download", "preview"],
    "Accounts": ["view", "upload", "editDetails", "download", "preview", "replace", "share", "viewDepartment"],
    "Support": ["view", "upload", "download", "preview"],
    "Marketing": ["view", "upload", "download", "preview"],
    "HR": ["view", "upload", "editDetails", "download", "preview", "replace", "viewDepartment"],
}
ADMIN_DOC_ROLES = ("Super Admin", "Admin")

# The CRM links a document can carry, most specific first: (key, collection, type, model attribute, record label attribute)
LINK_DEFS = [
    ("contractId", "contracts", "Contract"), ("projectId", "projects", "Project"), ("salesOrderId", "salesOrders", "Sales Order"), ("invoiceId", "invoices", "Invoice"),
    ("expenseId", "expenses", "Expense"), ("paymentId", "payments", "Payment"), ("quotationId", "quotations", "Quotation"), ("proposalId", "proposals", "Proposal"),
    ("dealId", "deals", "Deal"), ("leadId", "leads", "Lead"), ("enquiryId", "enquiries", "Enquiry"), ("taskId", "tasks", "Task"), ("ticketId", "tickets", "Ticket"), ("activityId", "activities", "Activity"),
    ("contactId", "contacts", "Contact"), ("companyId", "companies", "Company"), ("customerId", "customers", "Customer"), ("employeeId", "employees", "Employee"),
    ("campaignId", "campaigns", "Campaign"),
]
LINK_KEYS = [k for k, _, _ in LINK_DEFS]
LINK_BY_TYPE = {t: (k, c) for k, c, t in LINK_DEFS}
LINK_BY_KEY = {k: (c, t) for k, c, t in LINK_DEFS}
HREFS = {"Contract": "/contracts/{}", "Project": "/projects/{}", "Sales Order": "/sales-orders/{}", "Invoice": "/invoices/{}", "Expense": "/expenses/{}", "Payment": "/payments/{}",
         "Quotation": "/quotations/{}", "Proposal": "/proposals/{}", "Deal": "/deals/{}", "Lead": "/leads/{}", "Enquiry": "/enquiries/{}", "Task": "/tasks/{}", "Ticket": "/tickets/{}", "Activity": "/activities",
         "Contact": "/contacts/{}", "Company": "/companies/{}", "Customer": "/customers/{}", "Employee": "/employees/{}", "Campaign": "/campaigns/{}"}


def snake(key: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower()


# ---- file names ---------------------------------------------------------------------------------------------------------
DANGEROUS_EXT = set("exe dll bat cmd com msi scr pif js jse mjs vbs vbe wsf wsh ps1 psm1 sh bash zsh php phtml jsp asp aspx cgi jar war py pl rb hta lnk reg html htm xhtml svg xml swf apk app bin dmg iso inf "
                    "gadget docm xlsm pptm dotm xlam zip rar 7z gz tar cab sys drv ocx cpl".split())
RESERVED = re.compile(r"^(con|prn|aux|nul|com[0-9]|lpt[0-9])$", re.I)
_UNSAFE = re.compile("[\u0000-\u001f\u007f-\u009f<>:\"|?*‪-‮⁦-⁩]")


def ext_of(name: str) -> str:
    m = re.search(r"\.([a-z0-9]+)$", str(name or ""), re.I)
    return m.group(1).lower() if m else ""


def mime_for(ext: str) -> str:
    return FILE_TYPES[ext]["mimes"][0] if ext in FILE_TYPES else "application/octet-stream"


def sanitize_file_name(name) -> str:
    n = unicodedata.normalize("NFKC", str(name or ""))
    n = re.split(r"[\\/]", n)[-1]
    n = _UNSAFE.sub("", n)
    n = re.sub(r"\s+", " ", n)
    n = re.sub(r"\.{2,}", ".", n)
    n = re.sub(r"^[.\s]+|[.\s]+$", "", n)
    if len(n) > 150:
        e = ext_of(n)
        n = f"{n[:140 - len(e)]}{'.' + e if e else ''}"
    return n


def file_name_problems(raw) -> list[str]:
    problems: list[str] = []
    s = str(raw or "")
    if re.search(r"[\\/]", s) or re.search(r"(^|[\\/])\.\.($|[\\/])", s) or "\u0000" in s:
        problems.append("The file name contains a path or traversal sequence.")
    clean = sanitize_file_name(s)
    if not clean:
        problems.append("The file name is empty or unusable.")
        return problems
    base = re.sub(r"\.[^.]*$", "", clean)
    if RESERVED.match(base):
        problems.append("That file name is reserved by the operating system.")
    bad = next((p for p in (x.lower() for x in clean.split(".")[1:]) if p in DANGEROUS_EXT), None)
    if bad:
        problems.append(f"Files with the “.{bad}” extension are not allowed (including as part of a double extension).")
    return problems


# ---- content checks -----------------------------------------------------------------------------------------------------
EXEC_MAGIC = [
    (b"MZ", "a Windows executable"), (b"\x7fELF", "a Linux executable"), (b"\xca\xfe\xba\xbe", "a Java/Mach-O binary"), (b"\xcf\xfa\xed\xfe", "a macOS executable"), (b"#!", "a script"),
    (b"MSCF", "a cabinet archive"), (b"Rar!", "a RAR archive"), (b"7z\xbc\xaf", "a 7-Zip archive"), (b"\x1f\x8b", "a compressed archive"),
]
SCRIPT_RE = re.compile(r"<\s*script\b|<\?php|<%@|javascript\s*:|<\s*iframe\b|<\s*object\b|<\s*embed\b", re.I)
OLE = bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])


def zip_entry_names(data: bytes) -> list[str] | None:
    try:
        with zipfile.ZipFile(BytesIO(data)) as z:
            return [i.filename for i in z.infolist()]
    except (zipfile.BadZipFile, ValueError, OSError):
        return None


def _utf16(s: str) -> bytes:
    return s.encode("utf-16-le")


def _check_signature(ext: str, data: bytes) -> str:
    if ext == "pdf":
        if not data.startswith(b"%PDF-"):
            return "The content is not a PDF (missing the %PDF header)."
        if b"%%EOF" not in data[-2048:]:
            return "The PDF is truncated or corrupted (no end-of-file marker)."
        if re.search(rb"/(JavaScript|JS|Launch|OpenAction)\b", data):
            return "The PDF contains active content (scripts or launch actions), which is not allowed."
        return ""
    if ext == "png":
        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            return "The content is not a PNG image."
        if b"IEND" not in data[-32:]:
            return "The PNG is truncated or corrupted."
        return ""
    if ext in ("jpg", "jpeg"):
        if not data.startswith(b"\xff\xd8\xff"):
            return "The content is not a JPEG image."
        if not data.rstrip(b"\x00").endswith(b"\xff\xd9"):
            return "The JPEG is truncated or corrupted."
        return ""
    if ext == "webp":
        if not (data.startswith(b"RIFF") and data[8:12] == b"WEBP"):
            return "The content is not a WebP image."
        if int.from_bytes(data[4:8], "little") + 8 > len(data):
            return "The WebP image is truncated or corrupted."
        return ""
    if ext in ("doc", "xls", "ppt"):
        if not data.startswith(OLE):
            return f"The content is not a genuine .{ext} file."
        want = {"doc": "WordDocument", "xls": "Workbook", "ppt": "PowerPoint Document"}[ext]
        alt = "Book" if ext == "xls" else None
        if _utf16(want) not in data and not (alt and _utf16(alt) in data):
            return f"The file is an Office container but not a .{ext} document."
        if _utf16("_VBA_PROJECT") in data:
            return "The document contains macros, which are not allowed."
        return ""
    if ext in ("docx", "xlsx", "pptx"):
        if not data.startswith(b"PK\x03\x04"):
            return f"The content is not a genuine .{ext} file."
        names = zip_entry_names(data)
        if names is None:
            return f"The .{ext} file is corrupted (damaged archive)."
        if "[Content_Types].xml" not in names:
            return f"The .{ext} file is not a valid Office document."
        folder = {"docx": "word/", "xlsx": "xl/", "pptx": "ppt/"}[ext]
        if not any(n.startswith(folder) for n in names):
            return f"The file is a ZIP package but not a .{ext} document."
        if any(re.search(r"vbaProject\.bin$", n, re.I) for n in names):
            return "The document contains macros, which are not allowed."
        if any(re.search(r"\.(exe|dll|bat|cmd|com|scr|js|vbs|ps1|msi|jar)$", n, re.I) for n in names) or any(re.search(r"(^|/)\.\.(/|$)", n) or n.startswith("/") for n in names):
            return "The document contains an embedded executable or an unsafe path."
        return ""
    if ext == "csv":
        if b"\x00" in data:
            return "The CSV contains binary data."
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            return "The CSV is not valid UTF-8 text."
        if re.search(r"(^|[\r\n,;\"])\s*=\s*(cmd|powershell|msexcel|dde)\s*\|", text, re.I):
            return "The CSV contains a command-execution formula."
        return ""
    return "Unsupported file type."


@dataclass
class FileCheck:
    ok: bool
    errors: list[str]
    name: str
    ext: str
    mime: str
    family: str


def validate_file_content(name, mime: str | None, data: bytes, config: dict) -> FileCheck:
    errors: list[str] = list(file_name_problems(name))
    clean = sanitize_file_name(name)
    ext = ext_of(clean)
    size = len(data or b"")
    if size == 0:
        errors.append("The file is empty.")
    if not ext:
        errors.append("The file has no extension.")
    elif ext not in FILE_TYPES:
        errors.append(f".{ext} files are not supported.")
    elif ext not in config["allowedExtensions"]:
        errors.append(f".{ext} files are not allowed by your organisation’s settings.")
    limit = float(config.get("maxSizeMb") or 10) * 1024 * 1024
    if size > limit:
        errors.append(f"The file is {size / 1048576:.1f} MB — the limit is {config.get('maxSizeMb')} MB.")
    if mime and mime != "application/octet-stream" and ext in FILE_TYPES and mime.split(";")[0].strip().lower() not in FILE_TYPES[ext]["mimes"]:
        errors.append(f"The declared type ({mime}) does not match a .{ext} file.")
    if size and ext in FILE_TYPES and size <= limit:
        head = data[:1024]
        exec_kind = next((label for sig, label in EXEC_MAGIC if head.startswith(sig)), None)
        if exec_kind and ext not in ("docx", "xlsx", "pptx"):
            errors.append(f"The content is {exec_kind}, not a {ext.upper()} document.")
        else:
            problem = _check_signature(ext, data)
            if problem:
                errors.append(problem)
            elif ext in ("png", "jpg", "jpeg", "webp") and SCRIPT_RE.search(data.decode("latin-1")):
                errors.append("The image contains embedded script content.")
    return FileCheck(not errors, errors, clean, ext, mime_for(ext), FILE_TYPES.get(ext, {}).get("family", "other"))
