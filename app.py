import streamlit as st
import asyncio
import re
import time
import pandas as pd
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import gspread
import queue
from dotenv import load_dotenv
import os

# --- Load Configuration (.env file) --- #
load_dotenv()
GOOGLE_SHEETS_CREDENTIALS_PATH = os.getenv('GOOGLE_SHEETS_CREDENTIALS_PATH', 'google_sheets_credentials.json')
GOOGLE_SHEET_NAME = os.getenv('GOOGLE_SHEET_NAME', 'Lead Generation Data')

# --- Streamlit UI Setup --- #
st.set_page_config(layout="wide", page_title="SmartLeadGen Dashboard", page_icon="📊")
st.title("📊 SmartLeadGen Dashboard")
st.markdown("Automate lead generation from Google Maps and websites, with real-time updates.")

# Session state initialization
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
    Navigate to a webpage and return page content with retries for robustness.
    """
    while retries > 0:
        try:
            await page.goto(url, wait_until='domcontentloaded', timeout=30000)
            return await page.content()
        except Exception as e:
            retries -= 1
            send_update_to_ui('log', f"Retrying ({retries} left): Error accessing {url}: {e}")
    return None

def extract_emails_from_text(text):
    """
    Extract email addresses from the given text using regular expressions.
    """
    email_pattern = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    return list(set(email_pattern.findall(text)))

async def scrape_emails_from_website(page, website_url):
    """
    Extract email addresses from a specified website.
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
    except Exception as e:
        send_update_to_ui('log', f"Error scraping website {website_url}: {e}")
    return list(set(emails))

def get_google_sheet_client():
    """
    Authenticate and connect to Google Sheets.
    """
    try:
        gc = gspread.service_account(filename=GOOGLE_SHEETS_CREDENTIALS_PATH)
        spreadsheet = gc.open(GOOGLE_SHEET_NAME)
        worksheet = spreadsheet.sheet1
        # Ensure headers in the sheet
        if not worksheet.row_values(1):
            worksheet.append_row(['Keyword', 'Location', 'Business Name', 'Phone Number', 'Address', 'Website', 'Email'])
        send_update_to_ui('log', "Linked to Google Sheets successfully.")
        return worksheet
    except Exception as e:
        send_update_to_ui('log', f"Unable to connect to Google Sheets: {e}")
        return None

async def scrape_google_maps(keyword, location):
    """
    Search on Google Maps and scrape businesses based on the given keyword and location.
    """
    try:
        worksheet = get_google_sheet_client()
        if not worksheet:
            send_update_to_ui('status', 'stopped')
            return

        search_query = f"{keyword} in {location}"
        send_update_to_ui('log', f"Searching for: {search_query}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)  # Headless mode for speed
            page = await browser.new_page()

            maps_url = f"https://www.google.com/maps/search/{search_query.replace(' ', '+')}"
            await page.goto(maps_url, wait_until='domcontentloaded')
            await asyncio.sleep(2)

            businesses = set()
            while not st.session_state.stop_scraping:
                # Extract business details
                cards = await page.locator('div[class*="result"]').all()
                if not cards:
                    break

                for card in cards:
                    name = await card.locator('h3').text_content()
                    businesses.add(name)
                    # Simulate scrolling to load more results
                await page.evaluate("window.scrollBy(0, document.body.scrollHeight)")
                await asyncio.sleep(1)
            return None