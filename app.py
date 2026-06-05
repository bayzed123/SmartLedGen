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
import threading
import queue

# --- Configuration --- #
GOOGLE_SHEETS_CREDENTIALS_PATH = 'google_sheets_credentials.json'
GOOGLE_SHEET_NAME = 'Lead Generation Data'

# --- Streamlit UI Setup --- #
st.set_page_config(layout="wide", page_title="SmartLeadGen Dashboard", page_icon="📊")
st.title("📊 SmartLeadGen Dashboard")
st.markdown("Automate lead generation from Google Maps and websites, with real-time updates.")

# Initialize session state for data and logs
if 'leads_df' not in st.session_state:
    st.session_state.leads_df = pd.DataFrame(columns=['Keyword', 'Location', 'Business Name', 'Phone Number', 'Address', 'Website', 'Email'])
if 'log_messages' not in st.session_state:
    st.session_state.log_messages = []
if 'scraping_running' not in st.session_state:
    st.session_state.scraping_running = False
if 'stop_scraping' not in st.session_state:
    st.session_state.stop_scraping = False

# --- Queue for real-time updates --- #
# This queue will be used to pass messages and data from the background thread to the main Streamlit thread
if 'update_queue' not in st.session_state:
    st.session_state.update_queue = queue.Queue()

# --- Helper Functions (called from background thread) --- #
def send_update_to_ui(type, data):
    st.session_state.update_queue.put({'type': type, 'data': data})

async def get_page_content(page, url):
    try:
        await page.goto(url, wait_until='domcontentloaded', timeout=30000)
        return await page.content()
    except Exception as e:
        send_update_to_ui('log', f"Error navigating to {url}: {e}")
        return None

def extract_emails_from_text(text):
    email_pattern = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    return list(set(email_pattern.findall(text)))

async def scrape_emails_from_website(page, website_url):
    emails = []
    if not website_url or not website_url.startswith(('http://', 'https://')):
        return emails

    send_update_to_ui('log', f"  Visiting website: {website_url}")
    try:
        # Scrape homepage
        homepage_content = await get_page_content(page, website_url)
        if homepage_content:
            emails.extend(extract_emails_from_text(homepage_content))

        # Try to find contact page
        contact_page_urls = [
            f"{website_url}/contact",
            f"{website_url}/contact-us",
            f"{website_url}/about",
            f"{website_url}/reach-us",
        ]
        for contact_url in contact_page_urls:
            if st.session_state.stop_scraping: return [] # Check for stop signal
            contact_content = await get_page_content(page, contact_url)
            if contact_content:
                emails.extend(extract_emails_from_text(contact_content))
                if emails: # Stop if emails found on a contact page
                    break

    except Exception as e:
        send_update_to_ui('log', f"  Error scraping emails from {website_url}: {e}")
    return list(set(emails))

# --- Google Sheets Setup --- #
def get_google_sheet_client():
    try:
        gc = gspread.service_account(filename=GOOGLE_SHEETS_CREDENTIALS_PATH)
        spreadsheet = gc.open(GOOGLE_SHEET_NAME)
        worksheet = spreadsheet.sheet1
        # Add headers if the sheet is empty
        if not worksheet.row_values(1):
            worksheet.append_row(['Keyword', 'Location', 'Business Name', 'Phone Number', 'Address', 'Website', 'Email'])
        send_update_to_ui('log', f"Successfully connected to Google Sheet: {GOOGLE_SHEETS_CREDENTIALS_PATH}")
        return worksheet
    except Exception as e:
        send_update_to_ui('log', f"Error connecting to Google Sheets. Make sure '{GOOGLE_SHEETS_CREDENTIALS_PATH}' is correct and the sheet '{GOOGLE_SHEET_NAME}' exists and is shared with the service account. Error: {e}")
        return None

async def _run_scraper_async(keyword, location):
    worksheet = get_google_sheet_client()
    if not worksheet:
        send_update_to_ui('status', 'stopped')
        return

    search_query = f"{keyword} in {location}"
    send_update_to_ui('log', f"\nSearching Google Maps for: {search_query}")

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True) # Set to False for visual debugging
            page = await browser.new_page()

            # --- Google Maps Search --- #
            maps_url = f"https://www.google.com/maps/search/{search_query.replace(' ', '+')}"
            send_update_to_ui('log', f"Navigating to Google Maps: {maps_url}")
            await page.goto(maps_url, wait_until='domcontentloaded')
            await page.wait_for_selector('div[role="main"]') # Wait for the main content to load

            # --- Auto-scrolling and Scraping --- #
            send_update_to_ui('log', "Scrolling and scraping businesses...")
            unique_business_names = set()

            scrollable_div_selector = 'div[role="main"] > div > div > div:nth-child(1) > div > div > div > div > div > div:nth-child(2)'

            # Initial scroll to ensure content loads
            await page.evaluate(f"document.querySelector('{scrollable_div_selector}').scrollTop = document.querySelector('{scrollable_div_selector}').scrollHeight")
            time.sleep(2)

            while True:
                if st.session_state.stop_scraping: break # Check for stop signal
                last_count = len(await page.locator('div[role="main"] a[href*="!1s"]').all_text_contents())
                await page.evaluate(f"document.querySelector('{scrollable_div_selector}').scrollBy(0, 10000)") # Scroll down
                time.sleep(2) # Give time for new content to load
                new_count = len(await page.locator('div[role="main"] a[href*="!1s"]').all_text_contents())
                if new_count == last_count: # If no new businesses loaded after scroll
                    break
                send_update_to_ui('log', f"  Scrolled down, found {new_count} businesses so far...")

            # Extract business details
            html_content = await page.content()
            soup = BeautifulSoup(html_content, 'html.parser')

            business_cards = soup.select('div[role="main"] a[href*="!1s"]')

            for card in business_cards:
                if st.session_state.stop_scraping: break # Check for stop signal
                name_tag = card.select_one('div.fontHeadlineSmall')
                name = name_tag.get_text(strip=True) if name_tag else 'N/A'

                if name in unique_business_names:
                    continue
                unique_business_names.add(name)

                # Navigate to the business detail page to get more info
                business_detail_url = "https://www.google.com" + card['href']
                await page.goto(business_detail_url, wait_until='domcontentloaded')
                detail_html = await page.content()
                detail_soup = BeautifulSoup(detail_html, 'html.parser')

                phone = 'N/A'
                address = 'N/A'
                website = 'N/A'

                phone_tag = detail_soup.select_one('button[data-tooltip="Copy phone number"] div.fontBodyMedium')
                if phone_tag:
                    phone = phone_tag.get_text(strip=True)

                address_tag = detail_soup.select_one('button[data-tooltip="Copy address"] div.fontBodyMedium')
                if address_tag:
                    address = address_tag.get_text(strip=True)

                website_tag = detail_soup.select_one('a[data-tooltip="Open website"]')
                if website_tag:
                    website = website_tag['href']

                send_update_to_ui('log', f"  Found: {name}")
                send_update_to_ui('log', f"    Phone: {phone}")
                send_update_to_ui('log', f"    Address: {address}")
                send_update_to_ui('log', f"    Website: {website}")

                # --- Email Deep Scraper --- #
                emails = await scrape_emails_from_website(page, website)
                email_str = ', '.join(emails) if emails else 'N/A'
                send_update_to_ui('log', f"    Emails: {email_str}")

                business_data = {
                    'Keyword': keyword,
                    'Location': location,
                    'Business Name': name,
                    'Phone Number': phone,
                    'Address': address,
                    'Website': website,
                    'Email': email_str
                }

                # Update Streamlit DataFrame via a function that triggers rerun
                send_update_to_ui('data', business_data)

                # --- Live Google Sheets Export --- #
                try:
                    worksheet.append_row(list(business_data.values()))
                    send_update_to_ui('log', "    Data appended to Google Sheet.")
                except Exception as e:
                    send_update_to_ui('log', f"    Error appending data to Google Sheet: {e}")

            await browser.close()
        send_update_to_ui('log', "\n--- Scraping complete! ---")
        send_update_to_ui('log', f"Total businesses found and processed: {len(st.session_state.leads_df)} ")
    except Exception as e:
        send_update_to_ui('log', f"An error occurred during scraping: {e}")
    finally:
        send_update_to_ui('status', 'stopped')

def run_scraper_in_thread(keyword, location):
    asyncio.run(_run_scraper_async(keyword, location))

# --- Streamlit UI Layout --- #
with st.sidebar:
    st.header("Control Panel")
    keyword_input = st.text_input(
        "Enter Keyword",
        placeholder="e.g., Fashion Showroom, Real Estate Agency, Dental Clinic"
    )
    location_input = st.text_input(
        "Enter Location",
        placeholder="e.g., Dhaka, Chittagong, Tangail, Bangladesh"
    )

    col1, col2 = st.columns(2)
    with col1:
        if st.button("Start Lead Generation", type="primary", disabled=st.session_state.scraping_running):
            if keyword_input and location_input:
                st.session_state.log_messages = [] # Clear logs on new run
                st.session_state.leads_df = pd.DataFrame(columns=['Keyword', 'Location', 'Business Name', 'Phone Number', 'Address', 'Website', 'Email'])
                st.session_state.scraping_running = True
                st.session_state.stop_scraping = False
                send_update_to_ui('log', "Starting lead generation...")
                # Run the scraper in a separate thread to prevent UI freezing
                threading.Thread(target=run_scraper_in_thread, args=(keyword_input, location_input)).start()
                # No st.rerun() here, updates will be handled by the queue processing loop
            else:
                st.error("Please enter both Keyword and Location.")
    with col2:
        if st.button("Stop Scraping", type="secondary", disabled=not st.session_state.scraping_running):
            st.session_state.stop_scraping = True
            send_update_to_ui('log', "Stop signal sent. Finishing current task and shutting down.")
            # No st.rerun() here, status update will be handled by the queue processing loop

    st.download_button(
        label="Download as CSV",
        data=st.session_state.leads_df.to_csv(index=False).encode('utf-8'),
        file_name='smartleadgen_leads.csv',
        mime='text/csv',
        disabled=st.session_state.leads_df.empty
    )

# Main content area
st.subheader("Live Status Console")
log_display_area = st.empty()

st.subheader("Live Data Preview")
data_table_display_area = st.empty()

# Function to process updates from the queue and update UI
def process_queue_updates():
    while not st.session_state.update_queue.empty():
        update = st.session_state.update_queue.get()
        if update['type'] == 'log':
            st.session_state.log_messages.append(update['data'])
            if len(st.session_state.log_messages) > 100:
                st.session_state.log_messages = st.session_state.log_messages[-100:]
            log_display_area.text_area("Live Status Console", value="\n".join(st.session_state.log_messages[::-1]), height=300, key="log_area_display")
        elif update['type'] == 'data':
            new_lead_df = pd.DataFrame([update['data']])
            st.session_state.leads_df = pd.concat([st.session_state.leads_df, new_lead_df], ignore_index=True)
            data_table_display_area.dataframe(st.session_state.leads_df, use_container_width=True)
        elif update['type'] == 'status':
            if update['data'] == 'stopped':
                st.session_state.scraping_running = False
                # Trigger a rerun to update button states and spinner
                st.rerun()

# Continuously process updates from the queue
# This loop runs on every Streamlit rerun (user interaction, timer, etc.)
process_queue_updates()

# Initial display of log and data table (or after a rerun)
log_display_area.text_area("Live Status Console", value="\n".join(st.session_state.log_messages[::-1]), height=300, key="log_area_initial")
data_table_display_area.dataframe(st.session_state.leads_df, use_container_width=True)

# Display spinner if scraping is running
if st.session_state.scraping_running:
    st.spinner("Scraping in progress... Please wait.")

# --- Potential Enhancements (Manus AI suggestions) --- #
# 1. CAPTCHA Solving: If CAPTCHAs are encountered, integrate a CAPTCHA solving service API (e.g., 2Captcha, Anti-Captcha).
#    This would involve detecting CAPTCHAs and sending them to the service for resolution.
# 2. Advanced Email Hunting: For more comprehensive email extraction, consider using dedicated email finder APIs
#    (e.io, Snov.io) which can often find emails associated with a domain more reliably than scraping.
# 3. User-Agent Rotation: Rotate User-Agents to mimic different browsers and devices, reducing detection risk.
#    `page = await browser.new_page(user_agent='Mozilla/5.0...')`
# 4. Configuration File: Externalize configurations (selectors, sheet names, credentials path) into a config.ini or .env file.
# 5. Error Handling & Retries: Implement more sophisticated retry logic with exponential backoff for network requests and scraping failures.
# 6. Playwright Browser Context: Use browser contexts for isolation and better resource management, especially if running multiple scraping tasks concurrently.
# 7. Proxy Integration: For block resistance, integrate a proxy rotation service.
#    Example: Use 'proxy_server = "http://your_proxy_ip:port"' in browser launch options.
#    `browser = await p.chromium.launch(headless=True, proxy={'server': proxy_server})`
