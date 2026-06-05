import streamlit as st
import pandas as pd
from datetime import datetime

st.set_page_config(
    page_title="SmartLeadGen Pro",
    page_icon="🚀",
    layout="wide"
)

# -------------------------
# Demo Data (Replace with real data)
# -------------------------

total_leads = 245
emails_found = 178
websites_found = 212
running_status = "Running"

current_processed = 245
total_businesses = 375

progress_value = current_processed / total_businesses

eta = "03m 25s"

logs = [
    "✓ Lead #245 Saved",
    "✓ Google Sheet Updated",
    "✓ Email Found",
    "✓ Website Crawled",
    "✓ Processing New Business",
]

df = pd.DataFrame(
    [
        {
            "Business": "ABC Restaurant",
            "Email": "info@abc.com",
            "Phone": "+8801XXXXXXXXX",
            "Website": "abc.com"
        },
        {
            "Business": "XYZ Clinic",
            "Email": "contact@xyz.com",
            "Phone": "+8801XXXXXXXXX",
            "Website": "xyzclinic.com"
        }
    ]
)

# -------------------------
# Header
# -------------------------

st.title("🚀 SmartLeadGen Pro")
st.caption("Google Maps Lead Generation Dashboard")

# -------------------------
# Sidebar
# -------------------------

with st.sidebar:
    st.header("Lead Generation")

    keyword = st.text_input(
        "Keyword",
        placeholder="Dental Clinic"
    )

    location = st.text_input(
        "Location",
        placeholder="Dhaka"
    )

    st.button(
        "🚀 Start Scraping",
        use_container_width=True,
        type="primary"
    )

    st.button(
        "🛑 Stop Scraping",
        use_container_width=True
    )

# -------------------------
# KPI Cards
# -------------------------

col1, col2, col3, col4 = st.columns(4)

with col1:
    st.metric(
        "Total Leads",
        total_leads
    )

with col2:
    st.metric(
        "Emails Found",
        emails_found
    )

with col3:
    st.metric(
        "Websites Found",
        websites_found
    )

with col4:
    st.metric(
        "Status",
        running_status
    )

st.divider()

# -------------------------
# Current Activity
# -------------------------

left, right = st.columns([3, 1])

with left:

    st.subheader("Live Progress")

    st.progress(progress_value)

    st.write(
        f"Processing {current_processed} / {total_businesses}"
    )

with right:

    st.metric(
        "ETA",
        eta
    )

st.divider()

# -------------------------
# Status Panel
# -------------------------

status_col1, status_col2 = st.columns(2)

with status_col1:

    st.info(
        """
        🟢 Scraper Running

        Current Business:
        ABC Restaurant

        Current Website:
        abc.com
        """
    )

with status_col2:

    st.success(
        """
        ✓ Google Maps Connected

        ✓ Website Scanner Active

        ✓ Google Sheets Sync Active
        """
    )

st.divider()

# -------------------------
# Activity Feed
# -------------------------

st.subheader("📡 Live Activity Feed")

activity_container = st.container(
    border=True
)

with activity_container:
    for log in logs:
        st.write(log)

st.divider()

# -------------------------
# Recent Leads
# -------------------------

st.subheader("📋 Recent Leads")

st.dataframe(
    df,
    use_container_width=True,
    hide_index=True
)

st.divider()

# -------------------------
# Footer
# -------------------------

st.caption(
    f"Last Updated: {datetime.now().strftime('%H:%M:%S')}"
)