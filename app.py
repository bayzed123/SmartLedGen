"""
SmartLeadGen — Web Dashboard
Developer: Sayad Md Bayezid Hosan (sayadbayezid.com)

Finds potential digital-marketing clients by searching Google's official
Places API (New) for businesses matching a keyword + location, enriches
each result by visiting the business's own public website for a contact
email and social links, validates and deduplicates everything, scores
each lead by how much it likely needs a digital marketing agency's help,
shows it live, exports to CSV, and can push it straight to Google Sheets.
"""

import json
from datetime import datetime

import pandas as pd
import requests
import streamlit as st

from backend.enrichment import enrich_website
from backend.places_api import PlacesAPIError, build_query, search_all_pages
from backend.sheets_writer import HEADER_ROW, SheetsWriterError, append_leads, get_worksheet
from backend.validation import is_valid_business_name, make_dedup_key, normalize_phone, pick_primary_type, score_lead

LEAD_SCORE_EMOJI = {"High": "🔥", "Medium": "🟡", "Low": "⚪"}

# --------------------------------------------------------------------------
# Page config + theme
# --------------------------------------------------------------------------
st.set_page_config(page_title="SmartLeadGen", page_icon="📡", layout="wide")

st.markdown(
    """
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap');

    html, body, [class*="css"]  { font-family: 'Inter', sans-serif; }
    h1, h2, h3 { font-family: 'Space Grotesk', sans-serif !important; letter-spacing: -0.01em; }

    .slg-header {
        display: flex; align-items: center; gap: 14px;
        padding: 18px 22px; border-radius: 14px;
        background: linear-gradient(135deg, #0E7C6B 0%, #10151F 130%);
        color: white; margin-bottom: 20px;
    }
    .slg-ping { width: 14px; height: 14px; border-radius: 50%; background: #E8A33D; position: relative; flex-shrink: 0; }
    .slg-ping::after {
        content: ""; position: absolute; inset: -6px; border-radius: 50%;
        border: 2px solid #E8A33D; opacity: 0.6; animation: slg-pulse 1.8s ease-out infinite;
    }
    @keyframes slg-pulse { 0% { transform: scale(0.6); opacity: 0.8; } 100% { transform: scale(2.2); opacity: 0; } }
    .slg-title { font-family: 'Space Grotesk', sans-serif; font-size: 1.4rem; font-weight: 700; margin: 0; }
    .slg-subtitle { font-size: 0.82rem; opacity: 0.88; margin: 0; }

    .slg-badge-high { background:#FCEBD5; color:#9A5B10; padding:2px 10px; border-radius:20px; font-size:0.8rem; font-weight:600; }
    .slg-badge-medium { background:#E8EEF7; color:#3D5A80; padding:2px 10px; border-radius:20px; font-size:0.8rem; font-weight:600; }
    .slg-badge-low { background:#EEF1F4; color:#6B7684; padding:2px 10px; border-radius:20px; font-size:0.8rem; font-weight:600; }
    </style>

    <div class="slg-header">
        <div class="slg-ping"></div>
        <div>
            <p class="slg-title">SmartLeadGen</p>
            <p class="slg-subtitle">Digital marketing lead radar · built by Sayad Md Bayezid Hosan · sayadbayezid.com</p>
        </div>
    </div>
    """,
    unsafe_allow_html=True,
)

# --------------------------------------------------------------------------
# GA4 (best-effort — Streamlit doesn't give direct <head> control, so script
# execution via markdown injection is not as reliable here as on the
# Cloudflare frontend; treat this as supplementary, not authoritative).
# --------------------------------------------------------------------------
st.markdown(
    """
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-K2X859FJZV"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-K2X859FJZV');
    </script>
    """,
    unsafe_allow_html=True,
)

# --------------------------------------------------------------------------
# Access gate — shares the same access-code pool as the Cloudflare version
# (same backend, /api/streamlit/verify-code). No Cloudflare account needed
# here — just an email + the code.
#
# Remembered via URL query params, not just session_state: session_state
# resets on every reload/new tab/redeploy, which meant re-typing the email
# and code constantly. Once unlocked, the same values are written into the
# page URL — reopening that same link skips the form automatically. Use
# "Switch account" (in Admin settings, once unlocked) to clear it and log
# in as someone else on the same device.
# --------------------------------------------------------------------------
CLOUDFLARE_API_BASE = "https://smartleadgen-api.sayadmdbayezidhosan.workers.dev"


def attempt_verify(email: str, code: str) -> bool:
    try:
        resp = requests.post(
            f"{CLOUDFLARE_API_BASE}/api/streamlit/verify-code",
            json={"code": code, "email": email},
            timeout=10,
        )
        return resp.ok
    except Exception:
        return False


if not st.session_state.get("access_unlocked", False):
    qp_email = st.query_params.get("email", "")
    qp_code = st.query_params.get("code", "")
    if qp_email and qp_code and not st.session_state.get("auto_unlock_tried", False):
        st.session_state.auto_unlock_tried = True
        if attempt_verify(qp_email, qp_code):
            st.session_state.access_unlocked = True
            st.session_state.verified_email = qp_email
            st.session_state.verified_code = qp_code
            st.rerun()

if not st.session_state.get("access_unlocked", False):
    st.markdown("### 🔒 Enter your access code")
    st.caption("Get an access code from support@sayadbayezid.com to use SmartLeadGen.")
    gate_email = st.text_input("Your email", key="gate_email")
    gate_code = st.text_input("Access code", placeholder="SMARTGENTOOLS-XXXXXXXXXXXXXXX", key="gate_code")
    if st.button("Unlock", key="gate_unlock_btn"):
        if not gate_email.strip() or not gate_code.strip():
            st.warning("Enter both your email and the access code.")
        else:
            try:
                resp = requests.post(
                    f"{CLOUDFLARE_API_BASE}/api/streamlit/verify-code",
                    json={"code": gate_code.strip(), "email": gate_email.strip()},
                    timeout=10,
                )
                if resp.ok:
                    st.session_state.access_unlocked = True
                    # Kept for the rest of this session so save/load of this
                    # person's OWN config (Places key, Sheet, service account)
                    # can be tied to them specifically — not a shared secret.
                    st.session_state.verified_email = gate_email.strip()
                    st.session_state.verified_code = gate_code.strip()
                    # Remembered in the URL — reopening this same link later
                    # skips this form; no need to re-enter every time.
                    st.query_params["email"] = gate_email.strip()
                    st.query_params["code"] = gate_code.strip()
                    st.rerun()
                else:
                    try:
                        msg = resp.json().get("error", "That code isn't valid, or has already been used.")
                    except Exception:
                        msg = "That code isn't valid, or has already been used."
                    st.error(msg)
            except Exception as e:
                st.error(f"Couldn't verify the code right now — check your connection and try again. ({e})")
    st.stop()

# --------------------------------------------------------------------------
# Load this person's own saved config (their Places key, Sheet, service
# account) once per session, right after the gate — so it survives a
# session reset instead of needing to be re-entered every time. Saved
# per-email in Cloudflare D1, NOT a shared Streamlit Cloud secret — see
# save_streamlit_config() below for why that distinction matters.
# --------------------------------------------------------------------------
st.session_state.setdefault("runtime_config", {})  # also set later below; safe either way, needed here first

if not st.session_state.get("remote_config_loaded", False):
    try:
        resp = requests.get(
            f"{CLOUDFLARE_API_BASE}/api/streamlit/config",
            params={"email": st.session_state.verified_email, "code": st.session_state.verified_code},
            timeout=10,
        )
        if resp.ok:
            remote = resp.json()
            if remote.get("googlePlacesKey"):
                st.session_state.runtime_config["GOOGLE_PLACES_API_KEY"] = remote["googlePlacesKey"]
            if remote.get("sheetUrl"):
                st.session_state.runtime_config["GOOGLE_SHEET_URL"] = remote["sheetUrl"]
            if remote.get("serviceAccountJson"):
                st.session_state.runtime_config["GOOGLE_SERVICE_ACCOUNT_JSON"] = remote["serviceAccountJson"]
    except Exception:
        pass  # not fatal — the admin panel still works, just starts blank this session
    st.session_state.remote_config_loaded = True


def save_streamlit_config(**fields):
    """Pushes whichever of googlePlacesKey / sheetUrl / serviceAccountJson
    changed to Cloudflare D1, keyed by this person's own email — so it's
    THEIR key being billed for THEIR searches, not shared with every other
    visitor the way a Streamlit Cloud app-level Secret would be."""
    try:
        requests.post(
            f"{CLOUDFLARE_API_BASE}/api/streamlit/save-config",
            json={
                "email": st.session_state.verified_email,
                "code": st.session_state.verified_code,
                **fields,
            },
            timeout=10,
        )
    except Exception:
        pass  # saved for this session either way via runtime_config; remote save is best-effort

# --------------------------------------------------------------------------
# Session state
# --------------------------------------------------------------------------
st.session_state.setdefault("leads", [])
st.session_state.setdefault("dedup_keys", set())
st.session_state.setdefault("runtime_config", {})


def get_secret(name: str, default: str = ""):
    """Prefer a permanent deployed secret; fall back to a value entered
    in the admin panel for this session only."""
    try:
        if name in st.secrets:
            return st.secrets[name]
    except Exception:
        pass
    return st.session_state.runtime_config.get(name, default)


# --------------------------------------------------------------------------
# Admin / API settings — collapsed by default, masked inputs
# --------------------------------------------------------------------------
with st.expander("⚙️  Admin — API & Sheet settings", expanded=False):
    st.caption(
        "Keys typed here are masked and stay in this browser session only — never shown "
        "on screen again, never written to any file this app serves. For a deployed app, "
        "set these permanently via Streamlit's **Secrets** manager instead (see README) "
        "so they survive a restart."
    )

    col1, col2 = st.columns(2)
    with col1:
        places_configured = bool(get_secret("GOOGLE_PLACES_API_KEY"))
        places_input = st.text_input(
            "Google Places API key",
            type="password",
            placeholder="Configured via Secrets ✅" if places_configured else "Paste API key",
        )
        if places_input:
            st.session_state.runtime_config["GOOGLE_PLACES_API_KEY"] = places_input
            save_streamlit_config(googlePlacesKey=places_input)

        hunter_configured = bool(get_secret("HUNTER_API_KEY"))
        hunter_input = st.text_input(
            "Hunter.io API key (optional email fallback)",
            type="password",
            placeholder="Configured via Secrets ✅" if hunter_configured else "Optional — not required",
        )
        if hunter_input:
            st.session_state.runtime_config["HUNTER_API_KEY"] = hunter_input

    with col2:
        sheet_url_existing = get_secret("GOOGLE_SHEET_URL")
        sheet_url_input = st.text_input(
            "Google Sheet URL or ID",
            value=sheet_url_existing if sheet_url_existing else "",
            placeholder="https://docs.google.com/spreadsheets/d/...",
        )
        if sheet_url_input:
            st.session_state.runtime_config["GOOGLE_SHEET_URL"] = sheet_url_input
            save_streamlit_config(sheetUrl=sheet_url_input)

        sa_configured = bool(get_secret("GOOGLE_SERVICE_ACCOUNT_JSON"))
        sa_file = st.file_uploader(
            "Service account JSON" + (" — already configured ✅" if sa_configured else " (Sheets access)"),
            type=["json"],
        )
        if sa_file is not None:
            sa_json_text = sa_file.read().decode("utf-8")
            st.session_state.runtime_config["GOOGLE_SERVICE_ACCOUNT_JSON"] = sa_json_text
            save_streamlit_config(serviceAccountJson=sa_json_text)

    default_region = st.selectbox(
        "Default phone region (used only when a number has no country code)",
        ["BD", "US", "GB", "IN", "AE", "SA", "PK", "NP"],
        index=0,
    )

    st.divider()
    status_cols = st.columns(3)
    status_cols[0].metric("Places API", "Ready ✅" if get_secret("GOOGLE_PLACES_API_KEY") else "Not set ⚠️")
    status_cols[1].metric("Google Sheet", "Ready ✅" if get_secret("GOOGLE_SHEET_URL") else "Not set ⚠️")
    status_cols[2].metric("Service account", "Ready ✅" if get_secret("GOOGLE_SERVICE_ACCOUNT_JSON") else "Not set ⚠️")

    st.divider()
    st.caption(f"Signed in as **{st.session_state.get('verified_email', '')}**.")
    if st.button("🔁 Switch account"):
        st.query_params.clear()
        for key in ("access_unlocked", "verified_email", "verified_code", "auto_unlock_tried", "remote_config_loaded"):
            st.session_state.pop(key, None)
        st.rerun()

# --------------------------------------------------------------------------
# Search form
# --------------------------------------------------------------------------
st.subheader("🔍 Find leads")
form_col1, form_col2, form_col3 = st.columns([2, 2, 1])
with form_col1:
    keyword = st.text_input("Business type / keyword", placeholder="e.g. restaurant, dentist, boutique hotel")
with form_col2:
    location = st.text_input("Location", placeholder="e.g. Gulshan, Dhaka")
with form_col3:
    max_results = st.number_input("Max results", min_value=5, max_value=60, value=20, step=5)

opt_col1, opt_col2 = st.columns(2)
with opt_col1:
    run_enrichment = st.checkbox("Visit each website for email & social links (slower, more thorough)", value=True)
with opt_col2:
    auto_push_sheets = st.checkbox("Push this batch to Google Sheets automatically when done", value=False)

start_clicked = st.button("▶ Start search", type="primary")

progress_placeholder = st.empty()
status_placeholder = st.empty()
table_placeholder = st.empty()

# --------------------------------------------------------------------------
# Search execution
# --------------------------------------------------------------------------
if start_clicked:
    api_key = get_secret("GOOGLE_PLACES_API_KEY")
    if not keyword.strip():
        st.warning("Enter a business type or keyword first.")
    elif not api_key:
        st.error("Add your Google Places API key in ⚙️ Admin settings above first.")
    else:
        query = build_query(keyword, location)
        new_rows = []
        total_target = int(max_results)
        try:
            for i, place in enumerate(search_all_pages(api_key, query, max_total=total_target), start=1):
                name = (place.get("displayName") or {}).get("text", "")
                progress_placeholder.progress(min(i / total_target, 1.0))
                status_placeholder.markdown(f"Processing **{i}/{total_target}** — {name or 'unnamed listing'}")

                dedup_key = make_dedup_key(place)
                if not dedup_key or dedup_key in st.session_state.dedup_keys:
                    continue
                if not is_valid_business_name(name):
                    continue

                raw_phone = place.get("nationalPhoneNumber") or place.get("internationalPhoneNumber") or ""
                _, phone_e164 = normalize_phone(raw_phone, default_region=default_region)

                website = place.get("websiteUri", "")
                enrichment = {"email": None, "socials": {}}
                if run_enrichment and website:
                    enrichment = enrich_website(website)

                lead_score = score_lead(place, enrichment)
                socials = enrichment.get("socials", {})

                row = {
                    "Business Name": name,
                    "Sector/Category": pick_primary_type(place.get("types")).replace("_", " ").title(),
                    "Address": place.get("formattedAddress", ""),
                    "Phone": phone_e164 or raw_phone,
                    "Website": website,
                    "Email": enrichment.get("email") or "",
                    "Facebook": socials.get("facebook", ""),
                    "Instagram": socials.get("instagram", ""),
                    "LinkedIn": socials.get("linkedin", ""),
                    "Rating": place.get("rating"),
                    "Reviews": place.get("userRatingCount"),
                    "Lead Score": f"{LEAD_SCORE_EMOJI[lead_score]} {lead_score}",
                    "Google Maps Link": place.get("googleMapsUri", ""),
                    "Date Collected": datetime.now().strftime("%Y-%m-%d %H:%M"),
                }
                st.session_state.dedup_keys.add(dedup_key)
                st.session_state.leads.append(row)
                new_rows.append(row)

                table_placeholder.dataframe(pd.DataFrame(st.session_state.leads), width="stretch", height=420)

            status_placeholder.success(f"Done — {len(new_rows)} new lead(s) added this run "
                                        f"({total_target - len(new_rows)} skipped as duplicates/invalid).")

            if auto_push_sheets and new_rows:
                sheet_url = get_secret("GOOGLE_SHEET_URL")
                sa_json_str = get_secret("GOOGLE_SERVICE_ACCOUNT_JSON")
                if sheet_url and sa_json_str:
                    try:
                        sa_info = json.loads(sa_json_str)
                        worksheet = get_worksheet(sa_info, sheet_url)
                        rows_for_sheet = [[r[col] for col in HEADER_ROW] for r in new_rows]
                        append_leads(worksheet, rows_for_sheet)
                        st.success(f"Pushed {len(new_rows)} row(s) to Google Sheets.")
                    except (SheetsWriterError, json.JSONDecodeError) as e:
                        st.error(f"Google Sheets push failed: {e}")
                else:
                    st.warning("Add a Sheet URL and service account JSON in ⚙️ Admin settings to enable auto-push.")

        except PlacesAPIError as e:
            status_placeholder.error(str(e))

# --------------------------------------------------------------------------
# Persistent results view
# --------------------------------------------------------------------------
st.divider()
st.subheader("📊 Collected leads")

st.markdown(
    '<span class="slg-badge-high">🔥 High</span>&nbsp; no website or no online contact found — best-fit lead. &nbsp;&nbsp;'
    '<span class="slg-badge-medium">🟡 Medium</span>&nbsp; some presence but weak. &nbsp;&nbsp;'
    '<span class="slg-badge-low">⚪ Low</span>&nbsp; already well-established online.',
    unsafe_allow_html=True,
)

if st.session_state.leads:
    df = pd.DataFrame(st.session_state.leads)

    metric_cols = st.columns(4)
    metric_cols[0].metric("Total leads", len(df))
    metric_cols[1].metric("🔥 High opportunity", int(df["Lead Score"].str.contains("High", na=False).sum()))
    metric_cols[2].metric("With email", int((df["Email"] != "").sum()))
    metric_cols[3].metric("With phone", int((df["Phone"] != "").sum()))

    st.dataframe(df, width="stretch", height=420)

    csv_bytes = df.to_csv(index=False).encode("utf-8-sig")  # -sig so Excel shows non-English names correctly
    dl_col, sheet_col, clear_col = st.columns(3)
    with dl_col:
        st.download_button(
            "⬇ Download CSV",
            data=csv_bytes,
            file_name=f"smartleadgen_leads_{datetime.now().strftime('%Y%m%d_%H%M')}.csv",
            mime="text/csv",
            width="stretch",
        )
    with sheet_col:
        if st.button("📤 Push all to Google Sheets now", width="stretch"):
            sheet_url = get_secret("GOOGLE_SHEET_URL")
            sa_json_str = get_secret("GOOGLE_SERVICE_ACCOUNT_JSON")
            if not (sheet_url and sa_json_str):
                st.warning("Add a Sheet URL and service account JSON in ⚙️ Admin settings first.")
            else:
                try:
                    sa_info = json.loads(sa_json_str)
                    worksheet = get_worksheet(sa_info, sheet_url)
                    rows_for_sheet = [[r[col] for col in HEADER_ROW] for r in st.session_state.leads]
                    append_leads(worksheet, rows_for_sheet)
                    st.success(f"Pushed {len(rows_for_sheet)} row(s) to Google Sheets.")
                except (SheetsWriterError, json.JSONDecodeError) as e:
                    st.error(f"Google Sheets push failed: {e}")
    with clear_col:
        if st.button("🗑 Clear session results", width="stretch"):
            st.session_state.leads = []
            st.session_state.dedup_keys = set()
            st.rerun()
else:
    st.info("No leads collected yet this session — run a search above.")

st.caption("SmartLeadGen · Sayad Md Bayezid Hosan · sayadbayezid.com")
