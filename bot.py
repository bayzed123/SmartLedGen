
import asyncio
import re
import time
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import gspread
import json

# --- Configuration --- #
GOOGLE_SHEETS_CREDENTIALS_PATH = 'google_sheets_credentials.json'
GOOGLE_SHEET_NAME = 'Lead Generation Data'

# --- Helper Functions --- #
async def get_page_content(page, url):
    try:
        await page.goto(url, wait_until='domcontentloaded', timeout=30000)
        return await page.content()
    except Exception as e:
        print(f"Error navigating to {url}: {e}")
        return None

def extract_emails_from_text(text):
    email_pattern = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    return list(set(email_pattern.findall(text)))

async def scrape_emails_from_website(page, website_url):
    emails = []
    if not website_url or not website_url.startswith(('http://', 'https://')):
        return emails

    print(f"  Visiting website: {website_url}")
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
            contact_content = await get_page_content(page, contact_url)
            if contact_content:
                emails.extend(extract_emails_from_text(contact_content))
                if emails: # Stop if emails found on a contact page
                    break

    except Exception as e:
        print(f"  Error scraping emails from {website_url}: {e}")
    return list(set(emails))

async def main():
    print("\n--- SmartLeadGen Bot --- ")
    keyword = input("Enter Keyword (e.g., Fashion Showroom, Real Estate Agency, Dental Clinic, Restaurant, Interior Design, Tour Agency): ")
    location = input("Enter Location (e.g., Dhaka, Chittagong, Tangail, Bangladesh): ")

    search_query = f"{keyword} in {location}"
    print(f"\nSearching Google Maps for: {search_query}")

    # --- Google Sheets Setup --- #
    try:
        gc = gspread.service_account(filename=GOOGLE_SHEETS_CREDENTIALS_PATH)
        spreadsheet = gc.open(GOOGLE_SHEET_NAME)
        worksheet = spreadsheet.sheet1 # Assuming data goes into the first sheet
        # Add headers if the sheet is empty
        if not worksheet.row_values(1):
            worksheet.append_row(['Keyword', 'Location', 'Business Name', 'Phone Number', 'Address', 'Website', 'Email'])
        print(f"Successfully connected to Google Sheet: {GOOGLE_SHEET_NAME}")
    except Exception as e:
        print(f"Error connecting to Google Sheets. Make sure '{GOOGLE_SHEETS_CREDENTIALS_PATH}' is correct and the sheet '{GOOGLE_SHEET_NAME}' exists and is shared with the service account. Error: {e}")
        return

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True) # Set to False for visual debugging
        page = await browser.new_page()

        # --- Google Maps Search --- #
        maps_url = f"https://www.google.com/maps/search/{search_query.replace(' ', '+')}"
        print(f"Navigating to Google Maps: {maps_url}")
        await page.goto(maps_url, wait_until='domcontentloaded')
        await page.wait_for_selector('div[role="main"]') # Wait for the main content to load

        # --- Auto-scrolling and Scraping --- #
        print("Scrolling and scraping businesses...")
        businesses = []
        unique_business_names = set()

        # Scroll the left panel to load all businesses
        scrollable_div_selector = 'div[role="main"] > div > div > div:nth-child(1) > div > div > div > div > div > div:nth-child(2)'
        # This selector might need adjustment based on Google Maps UI changes

        last_height = await page.evaluate(f"document.querySelector('{scrollable_div_selector}').scrollHeight")
        while True:
            await page.evaluate(f"document.querySelector('{scrollable_div_selector}').scrollTop = document.querySelector('{scrollable_div_selector}').scrollHeight")
            time.sleep(2) # Give time for new content to load
            new_height = await page.evaluate(f"document.querySelector('{scrollable_div_selector}').scrollHeight")
            if new_height == last_height:
                break
            last_height = new_height

        # Extract business details
        html_content = await page.content()
        soup = BeautifulSoup(html_content, 'html.parser')

        # This selector is highly dependent on Google Maps HTML structure
        # It might need frequent updates.
        business_cards = soup.select('div[role="main"] a[href*="!1s"]') # Links to business details

        for card in business_cards:
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

            # Extract phone, address, website from detail page
            # These selectors are also prone to change
            phone_tag = detail_soup.select_one('button[data-tooltip="Copy phone number"] div.fontBodyMedium')
            if phone_tag:
                phone = phone_tag.get_text(strip=True)

            address_tag = detail_soup.select_one('button[data-tooltip="Copy address"] div.fontBodyMedium')
            if address_tag:
                address = address_tag.get_text(strip=True)

            website_tag = detail_soup.select_one('a[data-tooltip="Open website"]')
            if website_tag:
                website = website_tag['href']

            print(f"  Found: {name}")
            print(f"    Phone: {phone}")
            print(f"    Address: {address}")
            print(f"    Website: {website}")

            # --- Email Deep Scraper --- #
            emails = await scrape_emails_from_website(page, website)
            email_str = ', '.join(emails) if emails else 'N/A'
            print(f"    Emails: {email_str}")

            business_data = {
                'Keyword': keyword,
                'Location': location,
                'Business Name': name,
                'Phone Number': phone,
                'Address': address,
                'Website': website,
                'Email': email_str
            }
            businesses.append(business_data)

            # --- Live Google Sheets Export --- #
            try:
                worksheet.append_row(list(business_data.values()))
                print("    Data appended to Google Sheet.")
            except Exception as e:
                print(f"    Error appending data to Google Sheet: {e}")

        await browser.close()
    print("\n--- Scraping complete! ---")
    print(f"Total businesses found and processed: {len(businesses)}")

if __name__ == '__main__':
    asyncio.run(main())

# --- Potential Enhancements (Manus AI suggestions) --- #
# 1. Proxy Integration: For block resistance, integrate a proxy rotation service.
#    Example: Use 'proxy_server = "http://your_proxy_ip:port"' in browser launch options.
#    `browser = await p.chromium.launch(headless=True, proxy={'server': proxy_server})`
# 2. CAPTCHA Solving: If CAPTCHAs are encountered, integrate a CAPTCHA solving service API (e.g., 2Captcha, Anti-Captcha).
#    This would involve detecting CAPTCHAs and sending them to the service for resolution.
# 3. Advanced Email Hunting: For more comprehensive email extraction, consider using dedicated email finder APIs
#    (e.g., Hunter.io, Snov.io) which can often find emails associated with a domain more reliably than scraping.
# 4. Error Handling & Retries: Implement more sophisticated retry logic with exponential backoff for network requests and scraping failures.
# 5. User-Agent Rotation: Rotate User-Agents to mimic different browsers and devices, reducing detection risk.
#    `page = await browser.new_page(user_agent='Mozilla/5.0...')`
# 6. Headless vs. Headed: Provide an option for the user to run in headed mode for debugging purposes.
# 7. Configuration File: Externalize configurations (selectors, sheet names, credentials path) into a config.ini or .env file.
