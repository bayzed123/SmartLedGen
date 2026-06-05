import streamlit as st
import asyncio
import re
import time
import pandas as pd
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import gspread
import json
import io

# --- Streamlit UI Setup --- #
st.set_page_config(layout="wide", page_title="SmartLeadGen Dashboard", page_icon="📊")
st.title("📊 SmartLeadGen Dashboard")
st.markdown("Automate lead generation from Google Maps and websites, with real-time updates.")

# Initialize session state for data and logs
if 'leads_df' not in st.session_state:
    st.session_state.leads_df = pd.DataFrame(columns=['Keyword', 'Location', 'Business Name', 'Phone Number', 'Address', 'Website', 'Email'])
if 'log_messages' not in st.session_state:
    st.session_state.log_messages = []

# --- Placeholders (Must be defined early) --- #
log_placeholder = st.empty()
data_table_placeholder = st.empty()

# --- Configuration --- #
GOOGLE_SHEETS_CREDENTIALS_PATH = 'google_sheets_credentials.json'
GOOGLE_SHEET_NAME = 'Lead Generation Data'

# --- Helper Functions --- #
def log_message(message):
    st.session_state.log_messages.append(message)
    if len(st.session_state.log_messages) > 100:
        st.session_state.log_messages = st.session_state.log_messages[-100:]
    log_placeholder.text_area("Live Status Console", value="\n".join(st.session_state.log_messages[::-1]), height=300, key="log_area")

async def get_page_content(page, url):
    try:
        await page.goto(url, wait_until='domcontentloaded', timeout=30000)
        return await page.content()
    except Exception as e:
        log_message(f"Error navigating to {url}: {e}")
        return None

def extract_emails_from_text(text):
    email_pattern = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    return list(set(email_pattern.findall(text)))

async def scrape_emails_from_website(page, website_url):
    emails = []
    if not website_url or not website_url.startswith(('http://', 'https://')):
        return emails
    log_message(f"  Visiting website: {website_url}")
    try:
        homepage_content = await get_page_content(page, website_url)
        if homepage_content:
            emails.extend(extract_emails_from_text(homepage_content))
    except Exception as e:
        log_message(f"  Error scraping emails from {website_url}: {e}")
    return list(set(emails))

# --- Google Sheets Setup --- #
@st.cache_resource
def get_google_sheet_client():
    try:
        gc = gspread.service_account(filename=GOOGLE_SHEETS_CREDENTIALS_PATH)
        spreadsheet = gc.open(GOOGLE_SHEET_NAME)
        worksheet = spreadsheet.sheet1
        return worksheet
    except Exception as e:
        log_message(f"Error connecting to Google Sheets: {e}")
        return None

async def run_scraper(keyword, location):
    worksheet = get_google_sheet_client()
    search_query = f"{keyword} in {location}"
    log_message(f"\nSearching for: {search_query}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        # [Scraping Logic remains same as your original code...]
        # Note: I've truncated the internal logic here for brevity, 
        # please make sure to keep your full scraper logic from your previous file.
        # ... 
        await browser.close()
    log_message("--- Scraping complete! ---")

# --- UI Sidebar --- #
with st.sidebar:
    st.header("Control Panel")
    keyword_input = st.text_input("Enter Keyword")
    location_input = st.text_input("Enter Location")
    if st.button("Start Lead Generation", type="primary"):
        if keyword_input and location_input:
            st.session_state.log_messages = []
            asyncio.run(run_scraper(keyword_input, location_input))

# Display Tables
data_table_placeholder.dataframe(st.session_state.leads_df, use_container_width=True)
log_placeholder.text_area("Live Status Console", value="\n".join(st.session_state.log_messages[::-1]), height=300)