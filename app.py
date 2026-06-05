import streamlit as st
import asyncio
import re
import pandas as pd
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import gspread
import queue
from dotenv import load_dotenv
import os
import json

# --- Load Configuration from .env File --- #
load_dotenv()
GOOGLE_SHEETS_CREDENTIALS_PATH = os.getenv('GOOGLE_SHEETS_CREDENTIALS_PATH', 'google_sheets_credentials.json')
GOOGLE_SHEET_NAME = os.getenv('GOOGLE_SHEET_NAME', 'Lead Generation Data')

# --- Streamlit UI Setup --- #
st.set_page_config(layout="wide", page_title="SmartLeadGen Dashboard", page_icon="📊")
st.title("📊 SmartLeadGen Dashboard")
st.markdown("Automate lead generation from Google Maps and websites, with real-time updates.")

# Initialize session state for session variables
if 'leads_df' not in st.session_state:
    st.session_state.leads_df = pd.DataFrame(columns=['Keyword', 'Location', 'Business Name', 'Phone Number', 'Address', 'Website', 'Email'])
if 'log_messages' not in st.session_state:
    st.session_state.log_messages = []
if 'scraping_running' not in st.session_state:
    st.session_state.scraping_running = False
if 'stop_scraping' not in st.session_state:
    st.session_state.stop_scraping = False
if 'update_queue' not in st.session_state:
    st.session_state.update_queue = queue.Queue()

# --- Helper Functions --- #
def send_update_to_ui(type, data):
    st.session_state.update_queue.put({'type': type, 'data': data})

async def get_page_content(page, url, retries=3):
    """
    Navigate to a webpage and retrieve content with retries for robustness.
    """
    while retries > 0:
        try:
            await page.goto(url, wait_until='domcontentloaded', timeout=30000)
            return await page.content()
        except Exception as e:
            retries -= 1
            send_update_to_ui('log', f"Retrying ({retries} retries left): Error accessing {url}: {e}")
    return None

def extract_emails_from_text(text):
    """
    Extract email addresses from the given text using regex.
    """
    email_pattern = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    return list(set(email_pattern.findall(text)))

async def scrape_emails_from_website(page, website_url):
    """
    Scrape email addresses from a specified website URL and potential contact pages.
    """
    emails = []
    if not website_url or not website_url.startswith(('http://', 'https://')):
        return emails

    send_update_to_ui('log', f"Visiting website: {website_url}")
    try:
        homepage_content = await get_page_content(page, website_url)
        if homepage_content:
            emails.extend(extract_emails_from_text(homepage_content))

        # Check common contact pages
        contact_pages = [
            f"{website_url}/contact",
            f"{website_url}/contact-us",
            f"{website_url}/about",
        ]
        for contact_url in contact_pages:
            if st.session_state.stop_scraping:
                return []
            contact_content = await get_page_content(page, contact_url)
            if contact_content:
                emails.extend(extract_emails_from_text(contact_content))
                if emails:
                    break
    except Exception as e:
        send_update_to_ui('log', f"Error scraping website {website_url}: {e}")
    return list(set(emails))

def get_google_sheet_client():
    """
    Authenticate and connect to a Google Sheets document using st.secrets.
    """
    try:
        # সরাসরি Streamlit secrets থেকে ডেটা নেওয়া হচ্ছে, কোনো ফাইলের দরকার নেই
        creds_data = st.secrets["GOOGLE_CREDENTIALS"]
        if isinstance(creds_data, str):
            creds_dict = json.loads(creds_data)
        else:
            creds_dict = dict(creds_data)
            
        # --- MAGIC LINE: এই লাইনটি PEM MalformedFraming এরর ফিক্স করবে ---
        if "private_key" in creds_dict:
            creds_dict["private_key"] = creds_dict["private_key"].replace("\\n", "\n")
            
        gc = gspread.service_account_from_dict(creds_dict)
        spreadsheet = gc.open(GOOGLE_SHEET_NAME)
        worksheet = spreadsheet.sheet1
        
        # Ensure headers are added to the sheet
        if not worksheet.row_values(1):
            worksheet.append_row(['Keyword', 'Location', 'Business Name', 'Phone Number', 'Address', 'Website', 'Email'])
        send_update_to_ui('log', "Connected to Google Sheets successfully.")
        return worksheet
    except Exception as e:
        send_update_to_ui('log', f"Failed to connect to Google Sheets: {e}")
        return None

async def scrape_google_maps(keyword, location):
    """
    Perform scraping of businesses from Google Maps based on the keyword and location provided.
    """
    try:
        worksheet = get_google_sheet_client()
        if not worksheet:
            send_update_to_ui('status', 'stopped')
            return

        search_query = f"{keyword} in {location}"
        send_update_to_ui('log', f"Searching Google Maps with: {search_query}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)  # Use headless for performance
            page = await browser.new_page()
            maps_url = f"https://www.google.com/maps/search/{search_query.replace(' ', '+')}"
            await page.goto(maps_url, wait_until='domcontentloaded')
            await asyncio.sleep(2)

            business_names = set()
            while not st.session_state.stop_scraping:
                cards = await page.locator('div[role="main"] a[href*="!1s"]').all()
                if not cards:
                    break

                for card in cards:
                    name = await card.locator('div.fontHeadlineSmall').text_content()
                    if name not in business_names:
                        business_names.add(name)
                        send_update_to_ui('log', f"Business found: {name}")

            await browser.close()
        send_update_to_ui('log', f"Scraping completed for: {search_query}")
    except Exception as e:
        send_update_to_ui('log', f"Error during scraping process: {e}")
    finally:
        send_update_to_ui('status', 'stopped')

# --- Streamlit Sidebar Controls --- #
with st.sidebar:
    st.header("Control Panel")
    keyword = st.text_input("Enter Keyword", placeholder="e.g., Restaurants, Clinics, Agencies")
    location = st.text_input("Enter Location", placeholder="e.g., Dhaka, New York, Tokyo")

    col1, col2 = st.columns(2)
    with col1:
        if st.button("Start Scraping", type="primary", disabled=st.session_state.scraping_running):
            if keyword and location:
                st.session_state.scraping_running = True
                st.session_state.stop_scraping = False
                st.session_state.log_messages = []
                send_update_to_ui('log', "Initializing scraping process...")
                asyncio.run(scrape_google_maps(keyword, location))
            else:
                st.error("Please enter valid keyword and location.")
    with col2:
        if st.button("Stop Scraping", type="secondary", disabled=not st.session_state.scraping_running):
            st.session_state.stop_scraping = True
            send_update_to_ui('log', "Stopping the scraping process...")

# --- Live Status Console --- #
st.subheader("Log Console")
log_area = st.empty()

# --- Live Data Table --- #
st.subheader("Leads Table")
data_table = st.empty()

# Update log and data in real time
def update_ui():
    while not st.session_state.update_queue.empty():
        update = st.session_state.update_queue.get()
        if update['type'] == 'log':
            st.session_state.log_messages.append(update['data'])
            log_area.text_area("Logs", "\n".join(st.session_state.log_messages[-50:]), height=300)
        elif update['type'] == 'data':
            new_data = pd.DataFrame([update['data']])
            st.session_state.leads_df = pd.concat([st.session_state.leads_df, new_data], ignore_index=True)
            data_table.dataframe(st.session_state.leads_df, use_container_width=True)

update_ui()