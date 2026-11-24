"""Document Branding & Templates API (admin-managed, read by every print/PDF path)."""
import base64
import re
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.orm import Session

import branding as svc
from common import client_ip, log_audit_event
from database import get_db
from deps import current_hospital_id, get_current_user, require_permissions

router = APIRouter(prefix="/api/branding", tags=["branding"])


def _asset_payload(row, kind, with_data):
    rel = row.get(f"{kind}_path") if row else None
    path = svc.abs_path(rel)
    if not path:
        return None
    out = {"mime": row.get(f"{kind}_mime"), "width_px": row.get(f"{kind}_width_px"), "height_px": row.get(f"{kind}_height_px"),
           "url": f"/api/branding/asset/{kind}?v={row.get('version') or 1}"}
    if with_data:
        with open(path, "rb") as f:
            out["data_uri"] = f"data:{row.get(f'{kind}_mime')};base64," + base64.b64encode(f.read()).decode()
    return out


def _serialize(row, with_data=False):
    row = row or {}
    return {
        "configured": svc._is_custom(row),
        "hospital_title": row.get("hospital_title") or "",
        "title_font_size_pt": float(row.get("title_font_size_pt")) if row.get("title_font_size_pt") is not None else None,
        "logo_alignment": row.get("logo_alignment") or "left",
        "logo_offset_x_mm": float(row.get("logo_offset_x_mm") or 0),
        "logo_offset_y_mm": float(row.get("logo_offset_y_mm") or 0),
        "auto_fit_scaling": True if row.get("auto_fit_scaling") is None else bool(row.get("auto_fit_scaling")),
        "footer_text": row.get("footer_text") or "",
        "logo": _asset_payload(row, "logo", with_data),
        "footer": _asset_payload(row, "footer", with_data),
        "logo_box_mm": list(svc.LOGO_BOX_MM),
        "footer_box_mm": list(svc.FOOTER_BOX_MM),
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
        "updated_by": row.get("updated_by"),
    }


def _ensure_row(db, hospital_id, username):
    db.execute(text("INSERT INTO document_branding (hospital_id, updated_by) VALUES (:h, :u) ON CONFLICT (hospital_id) DO NOTHING"),
               {"h": hospital_id, "u": username})


@router.get("/public")
def public_branding(db: Session = Depends(get_db), user: dict = Depends(get_current_user), hospital_id: int = Depends(current_hospital_id)):
    """Read-only branding (with inline images) for the browser's print/PDF code. Any signed-in user."""
    out = _serialize(svc.fetch_row(db, hospital_id), with_data=True)
    out["watermarks"] = _public_watermarks(db, hospital_id)
    out["logos"] = _public_logos(db, hospital_id)
    return out


@router.get("")
def get_branding_settings(db: Session = Depends(get_db), user: dict = Depends(require_permissions("admin.use")),
                          hospital_id: int = Depends(current_hospital_id)):
    out = _serialize(svc.fetch_row(db, hospital_id))
    out["logos"] = [_logo_serialize(r) for r in svc.list_logos(db, hospital_id)]
    return out


@router.put("")
def update_branding_settings(request: Request, payload: dict = Body(...), db: Session = Depends(get_db),
                             user: dict = Depends(require_permissions("admin.use")), hospital_id: int = Depends(current_hospital_id)):
    title = str(payload.get("hospital_title") or "").strip()
    footer_text = str(payload.get("footer_text") or "").strip()
    align = str(payload.get("logo_alignment") or "left").strip().lower()
    if len(title) > 200:
        raise HTTPException(400, "Hospital title must be 200 characters or fewer.")
    if len(footer_text) > 500:
        raise HTTPException(400, "Footer text must be 500 characters or fewer.")
    if align not in svc.ALIGNMENTS:
        raise HTTPException(400, "Logo alignment must be left, center or right.")
    try:
        ox = float(payload.get("logo_offset_x_mm") or 0)
        oy = float(payload.get("logo_offset_y_mm") or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "Offsets must be numbers (mm).")
    lim = svc.OFFSET_LIMIT_MM
    if not (-lim <= ox <= lim and -lim <= oy <= lim):
        raise HTTPException(400, f"Offsets must be between -{lim:g} and {lim:g} mm.")
    raw_font_size = payload.get("title_font_size_pt")
    font_size_pt = None
    if raw_font_size not in (None, "", "auto", 0, "0"):
        try:
            font_size_pt = round(float(raw_font_size), 1)
            if not (6.0 <= font_size_pt <= 36.0):
                raise HTTPException(400, "Title font size must be between 6 and 36 pt.")
        except (ValueError, TypeError):
            raise HTTPException(400, "Title font size must be a valid number.")
    # No control characters in text that is drawn onto documents (preserves \r and \n).
    title, footer_text = (re.sub(r"[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]", " ", v) for v in (title, footer_text))
    _ensure_row(db, hospital_id, user.get("username"))
    db.execute(text("""UPDATE document_branding SET hospital_title = :t, title_font_size_pt = :fs, footer_text = :f, logo_alignment = :a,
                       logo_offset_x_mm = :ox, logo_offset_y_mm = :oy, auto_fit_scaling = :af,
                       version = version + 1, updated_by = :u, updated_at = NOW() WHERE hospital_id = :h"""),
               {"t": title or None, "fs": font_size_pt, "f": footer_text or None, "a": align, "ox": ox, "oy": oy,
                "af": bool(payload.get("auto_fit_scaling", True)), "u": user.get("username"), "h": hospital_id})
    log_audit_event(db, user, client_ip(request), "update", "branding", str(hospital_id), {"title": title, "alignment": align})
    db.commit()
    svc.invalidate(hospital_id)
    return _serialize(svc.fetch_row(db, hospital_id))


async def _upload(kind, request, file, db, user, hospital_id):
    data = await file.read(svc.MAX_UPLOAD_BYTES + 1)
    try:
        blob, mime, w, h = svc.process_asset(data, file.filename or "")
    except svc.BrandingError as exc:
        raise HTTPException(400, str(exc))
    _ensure_row(db, hospital_id, user.get("username"))
    old = svc.fetch_row(db, hospital_id) or {}
    rel = svc.save_asset(hospital_id, kind, blob, mime)
    db.execute(text(f"""UPDATE document_branding SET {kind}_path = :p, {kind}_mime = :m, {kind}_width_px = :w, {kind}_height_px = :h2,
                        version = version + 1, updated_by = :u, updated_at = NOW() WHERE hospital_id = :h"""),
               {"p": rel, "m": mime, "w": w, "h2": h, "u": user.get("username"), "h": hospital_id})
    log_audit_event(db, user, client_ip(request), "upload", "branding", str(hospital_id), {"asset": kind, "mime": mime, "size": [w, h]})
    db.commit()
    svc.remove_asset(old.get(f"{kind}_path"))
    svc.invalidate(hospital_id)
    return _serialize(svc.fetch_row(db, hospital_id))


@router.post("/logo")
async def upload_logo(request: Request, file: UploadFile = File(...), db: Session = Depends(get_db),
                      user: dict = Depends(require_permissions("admin.use")), hospital_id: int = Depends(current_hospital_id)):
    return await _upload("logo", request, file, db, user, hospital_id)


@router.post("/footer")
async def upload_footer(request: Request, file: UploadFile = File(...), db: Session = Depends(get_db),
                        user: dict = Depends(require_permissions("admin.use")), hospital_id: int = Depends(current_hospital_id)):
    return await _upload("footer", request, file, db, user, hospital_id)


def _delete(kind, request, db, user, hospital_id):
    old = svc.fetch_row(db, hospital_id)
    if old and old.get(f"{kind}_path"):
        db.execute(text(f"""UPDATE document_branding SET {kind}_path = NULL, {kind}_mime = NULL, {kind}_width_px = NULL, {kind}_height_px = NULL,
                            version = version + 1, updated_by = :u, updated_at = NOW() WHERE hospital_id = :h"""),
                   {"u": user.get("username"), "h": hospital_id})
        log_audit_event(db, user, client_ip(request), "remove", "branding", str(hospital_id), {"asset": kind})
        db.commit()
        svc.remove_asset(old.get(f"{kind}_path"))
        svc.invalidate(hospital_id)
    return _serialize(svc.fetch_row(db, hospital_id))


@router.delete("/logo")
def delete_logo(request: Request, db: Session = Depends(get_db), user: dict = Depends(require_permissions("admin.use")),
                hospital_id: int = Depends(current_hospital_id)):
    return _delete("logo", request, db, user, hospital_id)


@router.delete("/footer")
def delete_footer(request: Request, db: Session = Depends(get_db), user: dict = Depends(require_permissions("admin.use")),
                  hospital_id: int = Depends(current_hospital_id)):
    return _delete("footer", request, db, user, hospital_id)


@router.get("/asset/{kind}")
def get_asset(kind: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user),
              hospital_id: int = Depends(current_hospital_id)):
    if kind not in ("logo", "footer"):
        raise HTTPException(404, "Not found")
    row = svc.fetch_row(db, hospital_id) or {}
    path = svc.abs_path(row.get(f"{kind}_path"))
    if not path:
        raise HTTPException(404, "Not found")
    with open(path, "rb") as f:
        body = f.read()
    # SVG is served as an image only; the CSP blocks any script if it is opened directly.
    return Response(body, media_type=row.get(f"{kind}_mime"),
                    headers={"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff",
                             "Cache-Control": "private, max-age=300"})


# ------------------------------------------------------------------ watermarks --

def _wm_serialize(row):
    return {
        "id": row["id"], "name": row["name"], "modules": list(row.get("modules") or []),
        "opacity": float(row.get("opacity") or 0.12), "scale_pct": int(row.get("scale_pct") or 60), "active": bool(row.get("active")),
        "width_px": row.get("width_px"), "height_px": row.get("height_px"),
        "image_url": f"/api/branding/watermark-asset/{row['id']}?t={int(row['updated_at'].timestamp()) if row.get('updated_at') else 0}" if row.get("image_path") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None, "created_by": row.get("created_by"),
    }


def _public_watermarks(db, hospital_id):
    out = []
    for r in svc.list_watermarks(db, hospital_id, active_only=True):
        path = svc.abs_path(r.get("image_path"))
        if not path or not r.get("modules"):
            continue
        with open(path, "rb") as f:
            uri = "data:image/png;base64," + base64.b64encode(f.read()).decode()
        out.append({"modules": list(r["modules"]), "opacity": float(r.get("opacity") or 0.12), "scale_pct": int(r.get("scale_pct") or 60),
                    "width_px": r.get("width_px"), "height_px": r.get("height_px"), "data_uri": uri})
    return out


def _wm_fields(modules, opacity, scale_pct):
    """Validate the user-chosen settings; returns (modules list, opacity, scale)."""
    if isinstance(modules, str):
        modules = [m for m in re.split(r"[,\s]+", modules) if m]
    modules = list(dict.fromkeys(str(m).strip() for m in (modules or [])))
    bad = [m for m in modules if m not in svc.WATERMARK_MODULE_IDS]
    if bad:
        raise HTTPException(400, f"Unknown module: {', '.join(bad)}.")
    if not modules:
        raise HTTPException(400, "Choose at least one module for this watermark.")
    try:
        opacity = round(float(opacity), 2)
        scale_pct = int(float(scale_pct))
    except (TypeError, ValueError):
        raise HTTPException(400, "Opacity and size must be numbers.")
    if not (0.03 <= opacity <= 1.0):
        raise HTTPException(400, "Opacity must be between 3% and 100%.")
    if not (10 <= scale_pct <= 100):
        raise HTTPException(400, "Size must be between 10% and 100% of the page width.")
    return modules, opacity, scale_pct


def _check_module_conflicts(db, hospital_id, modules, exclude_id=None):
    """A module can carry only one active watermark, otherwise it would be ambiguous which one prints."""
    labels = dict(svc.WATERMARK_MODULES)
    for r in svc.list_watermarks(db, hospital_id, active_only=True):
        if exclude_id and r["id"] == exclude_id:
            continue
        clash = [m for m in modules if m in (r.get("modules") or [])]
        if clash:
            raise HTTPException(409, f"{', '.join(labels[m] for m in clash)} already use the watermark \"{r['name']}\". Remove the module from it first.")


def _clean_wm_name(name):
    name = re.sub(r"[\x00-\x1f\x7f]", " ", str(name or "")).strip()
    if not name or len(name) > 100:
        raise HTTPException(400, "Give the watermark a name (up to 100 characters).")
    return name


@router.get("/watermarks")
def list_watermarks(db: Session = Depends(get_db), user: dict = Depends(require_permissions("admin.use")), hospital_id: int = Depends(current_hospital_id)):
    return {"watermarks": [_wm_serialize(r) for r in svc.list_watermarks(db, hospital_id)],
            "modules": [{"id": m, "label": l} for m, l in svc.WATERMARK_MODULES]}


@router.post("/watermarks")
async def create_watermark(request: Request, name: str = Form(...), modules: str = Form(...), opacity: float = Form(0.12), scale_pct: int = Form(60),
                           file: UploadFile = File(...), db: Session = Depends(get_db), user: dict = Depends(require_permissions("admin.use")),
                           hospital_id: int = Depends(current_hospital_id)):
    name = _clean_wm_name(name)
    mods, opacity, scale_pct = _wm_fields(modules, opacity, scale_pct)
    data = await file.read(svc.WATERMARK_MAX_BYTES + 1)
    try:
        blob, mime, w, h = svc.process_watermark(data, file.filename or "")
    except svc.BrandingError as exc:
        raise HTTPException(400, str(exc))
    _check_module_conflicts(db, hospital_id, mods)
    wm_id = db.execute(text("""INSERT INTO document_watermarks (hospital_id, name, image_mime, width_px, height_px, modules, opacity, scale_pct, created_by)
                               VALUES (:h, :n, :m, :w, :ht, :mods, :o, :s, :u) RETURNING id"""),
                       {"h": hospital_id, "n": name, "m": mime, "w": w, "ht": h, "mods": mods, "o": opacity, "s": scale_pct, "u": user.get("username")}).scalar()
    rel = svc.save_watermark(hospital_id, wm_id, blob)
    db.execute(text("UPDATE document_watermarks SET image_path = :p WHERE id = :i"), {"p": rel, "i": wm_id})
    log_audit_event(db, user, client_ip(request), "create", "watermark", str(wm_id), {"name": name, "modules": mods})
    db.commit()
    svc.invalidate_watermarks(hospital_id)
    return await _wm_response(db, hospital_id)


async def _wm_response(db, hospital_id):
    return {"watermarks": [_wm_serialize(r) for r in svc.list_watermarks(db, hospital_id)],
            "modules": [{"id": m, "label": l} for m, l in svc.WATERMARK_MODULES]}


def _get_wm(db, hospital_id, wm_id):
    row = db.execute(text("SELECT * FROM document_watermarks WHERE id = :i AND hospital_id = :h"), {"i": wm_id, "h": hospital_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Watermark not found.")
    return dict(row)


@router.put("/watermarks/{wm_id}")
async def update_watermark(wm_id: int, request: Request, payload: dict = Body(...), db: Session = Depends(get_db),
                           user: dict = Depends(require_permissions("admin.use")), hospital_id: int = Depends(current_hospital_id)):
    row = _get_wm(db, hospital_id, wm_id)
    name = _clean_wm_name(payload.get("name", row["name"]))
    mods, opacity, scale_pct = _wm_fields(payload.get("modules", row["modules"]), payload.get("opacity", row["opacity"]), payload.get("scale_pct", row["scale_pct"]))
    active = bool(payload.get("active", row["active"]))
    if active:
        _check_module_conflicts(db, hospital_id, mods, exclude_id=wm_id)
    db.execute(text("""UPDATE document_watermarks SET name = :n, modules = :mods, opacity = :o, scale_pct = :s, active = :a, updated_at = NOW()
                       WHERE id = :i"""), {"n": name, "mods": mods, "o": opacity, "s": scale_pct, "a": active, "i": wm_id})
    log_audit_event(db, user, client_ip(request), "update", "watermark", str(wm_id), {"name": name, "modules": mods, "active": active})
    db.commit()
    svc.invalidate_watermarks(hospital_id)
    return await _wm_response(db, hospital_id)


@router.post("/watermarks/{wm_id}/image")
async def replace_watermark_image(wm_id: int, request: Request, file: UploadFile = File(...), db: Session = Depends(get_db),
                                  user: dict = Depends(require_permissions("admin.use")), hospital_id: int = Depends(current_hospital_id)):
    row = _get_wm(db, hospital_id, wm_id)
    data = await file.read(svc.WATERMARK_MAX_BYTES + 1)
    try:
        blob, mime, w, h = svc.process_watermark(data, file.filename or "")
    except svc.BrandingError as exc:
        raise HTTPException(400, str(exc))
    rel = svc.save_watermark(hospital_id, wm_id, blob)
    db.execute(text("UPDATE document_watermarks SET image_path = :p, image_mime = :m, width_px = :w, height_px = :h, updated_at = NOW() WHERE id = :i"),
               {"p": rel, "m": mime, "w": w, "h": h, "i": wm_id})
    log_audit_event(db, user, client_ip(request), "replace_image", "watermark", str(wm_id), {})
    db.commit()
    svc.remove_asset(row.get("image_path"))
    svc.invalidate_watermarks(hospital_id)
    return await _wm_response(db, hospital_id)


@router.delete("/watermarks/{wm_id}")
async def delete_watermark(wm_id: int, request: Request, db: Session = Depends(get_db),
                           user: dict = Depends(require_permissions("admin.use")), hospital_id: int = Depends(current_hospital_id)):
    row = _get_wm(db, hospital_id, wm_id)
    db.execute(text("DELETE FROM document_watermarks WHERE id = :i"), {"i": wm_id})
    log_audit_event(db, user, client_ip(request), "delete", "watermark", str(wm_id), {"name": row["name"]})
    db.commit()
    svc.remove_asset(row.get("image_path"))
    svc.invalidate_watermarks(hospital_id)
    return await _wm_response(db, hospital_id)


@router.get("/watermark-asset/{wm_id}")
def get_watermark_asset(wm_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user), hospital_id: int = Depends(current_hospital_id)):
    row = _get_wm(db, hospital_id, wm_id)
    path = svc.abs_path(row.get("image_path"))
    if not path:
        raise HTTPException(404, "Not found")
    with open(path, "rb") as f:
        body = f.read()
    return Response(body, media_type="image/png", headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300"})


# ---------------------------------------------------------------------- logos --

def _logo_serialize(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "alignment": row.get("alignment") or "left",
        "offset_x_mm": float(row.get("offset_x_mm") or 0),
        "offset_y_mm": float(row.get("offset_y_mm") or 0),
        "auto_fit_scaling": True if row.get("auto_fit_scaling") is None else bool(row.get("auto_fit_scaling")),
        "modules": list(row.get("modules") or []),
        "active": bool(row.get("active")),
        "width_px": row.get("width_px"),
        "height_px": row.get("height_px"),
        "mime": row.get("image_mime"),
        "image_url": f"/api/branding/logo-asset/{row['id']}?t={int(row['updated_at'].timestamp()) if row.get('updated_at') else 0}" if row.get("image_path") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
        "created_by": row.get("created_by"),
    }


def _public_logos(db, hospital_id):
    out = []
    for r in svc.list_logos(db, hospital_id, active_only=True):
        path = svc.abs_path(r.get("image_path"))
        if not path:
            continue
        mime = r.get("image_mime") or "image/png"
        with open(path, "rb") as f:
            uri = f"data:{mime};base64," + base64.b64encode(f.read()).decode()
        out.append({
            "id": r["id"],
            "name": r["name"],
            "alignment": r.get("alignment") or "left",
            "offset_x_mm": float(r.get("offset_x_mm") or 0),
            "offset_y_mm": float(r.get("offset_y_mm") or 0),
            "auto_fit_scaling": True if r.get("auto_fit_scaling") is None else bool(r.get("auto_fit_scaling")),
            "modules": list(r.get("modules") or []),
            "width_px": r.get("width_px"),
            "height_px": r.get("height_px"),
            "mime": mime,
            "url": f"/api/branding/logo-asset/{r['id']}",
            "data_uri": uri,
        })
    return out


async def _logo_response(db, hospital_id):
    return {
        "logos": [_logo_serialize(r) for r in svc.list_logos(db, hospital_id)],
        "modules": [{"id": m, "label": l} for m, l in svc.WATERMARK_MODULES],
    }


def _get_logo(db, hospital_id, logo_id):
    row = db.execute(text("SELECT * FROM document_logos WHERE id = :i AND hospital_id = :h"), {"i": logo_id, "h": hospital_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Logo not found.")
    return dict(row)


@router.get("/logos")
def list_logos(db: Session = Depends(get_db), user: dict = Depends(require_permissions("admin.use")), hospital_id: int = Depends(current_hospital_id)):
    return {
        "logos": [_logo_serialize(r) for r in svc.list_logos(db, hospital_id)],
        "modules": [{"id": m, "label": l} for m, l in svc.WATERMARK_MODULES],
    }


@router.post("/logos")
async def create_logo(
    request: Request,
    name: str = Form(...),
    alignment: str = Form("left"),
    offset_x_mm: float = Form(0),
    offset_y_mm: float = Form(0),
    auto_fit_scaling: bool = Form(True),
    modules: str = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: dict = Depends(require_permissions("admin.use")),
    hospital_id: int = Depends(current_hospital_id),
):
    name = re.sub(r"[\x00-\x1f\x7f]", " ", str(name or "")).strip()
    if not name or len(name) > 100:
        raise HTTPException(400, "Give the logo a name (up to 100 characters).")
    align = str(alignment or "left").strip().lower()
    if align not in svc.ALIGNMENTS:
        raise HTTPException(400, "Alignment must be left, center or right.")
    lim = svc.OFFSET_LIMIT_MM
    if not (-lim <= offset_x_mm <= lim and -lim <= offset_y_mm <= lim):
        raise HTTPException(400, f"Offsets must be between -{lim:g} and {lim:g} mm.")
    if isinstance(modules, str):
        mods = [m.strip() for m in re.split(r"[,\s]+", modules) if m.strip()]
    else:
        mods = list(modules or [])
    data = await file.read(svc.MAX_UPLOAD_BYTES + 1)
    try:
        blob, mime, w, h = svc.process_asset(data, file.filename or "")
    except svc.BrandingError as exc:
        raise HTTPException(400, str(exc))
    logo_id = db.execute(
        text("""INSERT INTO document_logos (hospital_id, name, image_mime, width_px, height_px, alignment, offset_x_mm, offset_y_mm, auto_fit_scaling, modules, created_by)
                VALUES (:h, :n, :m, :w, :ht, :al, :ox, :oy, :af, :mods, :u) RETURNING id"""),
        {"h": hospital_id, "n": name, "m": mime, "w": w, "ht": h, "al": align, "ox": offset_x_mm, "oy": offset_y_mm, "af": auto_fit_scaling, "mods": mods, "u": user.get("username")},
    ).scalar()
    rel = svc.save_logo_entry(hospital_id, logo_id, blob, mime)
    db.execute(text("UPDATE document_logos SET image_path = :p WHERE id = :i"), {"p": rel, "i": logo_id})
    log_audit_event(db, user, client_ip(request), "create", "logo", str(logo_id), {"name": name, "modules": mods, "alignment": align})
    db.commit()
    svc.invalidate_logos(hospital_id)
    return await _logo_response(db, hospital_id)


@router.put("/logos/{logo_id}")
async def update_logo(
    logo_id: int, request: Request, payload: dict = Body(...), db: Session = Depends(get_db),
    user: dict = Depends(require_permissions("admin.use")), hospital_id: int = Depends(current_hospital_id),
):
    row = _get_logo(db, hospital_id, logo_id)
    name = re.sub(r"[\x00-\x1f\x7f]", " ", str(payload.get("name", row["name"]))).strip()
    if not name or len(name) > 100:
        raise HTTPException(400, "Give the logo a name (up to 100 characters).")
    align = str(payload.get("alignment", row.get("alignment") or "left")).strip().lower()
    if align not in svc.ALIGNMENTS:
        raise HTTPException(400, "Alignment must be left, center or right.")
    try:
        ox = float(payload.get("offset_x_mm", row.get("offset_x_mm") or 0))
        oy = float(payload.get("offset_y_mm", row.get("offset_y_mm") or 0))
    except (TypeError, ValueError):
        raise HTTPException(400, "Offsets must be numbers.")
    lim = svc.OFFSET_LIMIT_MM
    if not (-lim <= ox <= lim and -lim <= oy <= lim):
        raise HTTPException(400, f"Offsets must be between -{lim:g} and {lim:g} mm.")
    raw_mods = payload.get("modules", row["modules"])
    if isinstance(raw_mods, str):
        mods = [m.strip() for m in re.split(r"[,\s]+", raw_mods) if m.strip()]
    else:
        mods = list(raw_mods or [])
    auto_fit = bool(payload.get("auto_fit_scaling", row.get("auto_fit_scaling", True)))
    active = bool(payload.get("active", row.get("active", True)))
    db.execute(
        text("""UPDATE document_logos SET name = :n, alignment = :al, offset_x_mm = :ox, offset_y_mm = :oy,
                auto_fit_scaling = :af, modules = :mods, active = :a, updated_at = NOW() WHERE id = :i"""),
        {"n": name, "al": align, "ox": ox, "oy": oy, "af": auto_fit, "mods": mods, "a": active, "i": logo_id},
    )
    log_audit_event(db, user, client_ip(request), "update", "logo", str(logo_id), {"name": name, "modules": mods, "active": active})
    db.commit()
    svc.invalidate_logos(hospital_id)
    return await _logo_response(db, hospital_id)


@router.post("/logos/{logo_id}/image")
async def replace_logo_image(
    logo_id: int, request: Request, file: UploadFile = File(...), db: Session = Depends(get_db),
    user: dict = Depends(require_permissions("admin.use")), hospital_id: int = Depends(current_hospital_id),
):
    row = _get_logo(db, hospital_id, logo_id)
    data = await file.read(svc.MAX_UPLOAD_BYTES + 1)
    try:
        blob, mime, w, h = svc.process_asset(data, file.filename or "")
    except svc.BrandingError as exc:
        raise HTTPException(400, str(exc))
    rel = svc.save_logo_entry(hospital_id, logo_id, blob, mime)
    db.execute(text("UPDATE document_logos SET image_path = :p, image_mime = :m, width_px = :w, height_px = :h, updated_at = NOW() WHERE id = :i"),
               {"p": rel, "m": mime, "w": w, "h": h, "i": logo_id})
    log_audit_event(db, user, client_ip(request), "replace_image", "logo", str(logo_id), {})
    db.commit()
    svc.remove_asset(row.get("image_path"))
    svc.invalidate_logos(hospital_id)
    return await _logo_response(db, hospital_id)


@router.delete("/logos/{logo_id}")
async def delete_logo(
    logo_id: int, request: Request, db: Session = Depends(get_db),
    user: dict = Depends(require_permissions("admin.use")), hospital_id: int = Depends(current_hospital_id),
):
    row = _get_logo(db, hospital_id, logo_id)
    db.execute(text("DELETE FROM document_logos WHERE id = :i"), {"i": logo_id})
    log_audit_event(db, user, client_ip(request), "delete", "logo", str(logo_id), {"name": row["name"]})
    db.commit()
    svc.remove_asset(row.get("image_path"))
    svc.invalidate_logos(hospital_id)
    return await _logo_response(db, hospital_id)


@router.get("/logo-asset/{logo_id}")
def get_logo_asset(logo_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user), hospital_id: int = Depends(current_hospital_id)):
    row = _get_logo(db, hospital_id, logo_id)
    path = svc.abs_path(row.get("image_path"))
    if not path:
        raise HTTPException(404, "Not found")
    with open(path, "rb") as f:
        body = f.read()
    return Response(body, media_type=row.get("image_mime") or "image/png", headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300"})

