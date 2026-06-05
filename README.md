# SmartLeadGen Bot

## Overview

The SmartLeadGen Bot is a powerful Python automation tool designed to assist digital marketing agencies and businesses in identifying potential clients who are actively spending on advertising. By leveraging Google Maps data, website scraping, and real-time Google Sheets integration, this bot streamlines the lead generation process, focusing on businesses within specified keywords and locations.

## Features

- **Dynamic User Input:** Prompts for Keyword and Location, allowing flexible search queries.
- **Google Maps Search Automation:** Utilizes Playwright to automate browser interactions for Google Maps searches.
- **Comprehensive Scraping:** Automatically scrolls and extracts business names, phone numbers, addresses, and website URLs from Google Maps.
- **Email Deep Scraper:** Visits extracted business websites and scans homepages and contact pages for email addresses using BeautifulSoup and Regex.
- **Live Google Sheets Export:** Appends all collected data directly to a Google Sheet in real-time using `gspread`.

## Technical Stack

- **Python 3.x**
- **Playwright:** For browser automation and web scraping.
- **BeautifulSoup4:** For parsing HTML content and extracting data.
- **gspread:** For interacting with Google Sheets API.
- **re (Regex):** For email pattern matching.

## Setup and Installation

Follow these steps to get your SmartLeadGen Bot up and running.

### 1. Clone the Repository

```bash
git clone https://github.com/bayzed123/SmartLeadGen.git
cd SmartLeadGen
```

### 2. Install Dependencies

It's recommended to use a virtual environment.

```bash
python3 -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`
pip install -r requirements.txt
playwright install  # Install Playwright browser binaries
```

### 3. Google Sheets API Credentials Setup

To enable the bot to write data to your Google Sheet, you need to set up Google Sheets API credentials.

1.  **Enable the Google Sheets API:**
    - Go to the [Google Cloud Console](https://console.cloud.google.com/).
    - Create a new project or select an existing one.
    - Navigate to "APIs & Services" > "Enabled APIs & Services."
    - Search for "Google Sheets API" and enable it.

2.  **Create Service Account Credentials:**
    - In the Google Cloud Console, go to "APIs & Services" > "Credentials."
    - Click "Create Credentials" > "Service Account."
    - Give your service account a name (e.g., `smart-leadgen-bot`).
    - Grant it a role (e.g., `Project` > `Editor` or `Viewer` for broader access, or more restrictively `Google Sheets` > `Google Sheets Editor`).
    - Click "Done."

3.  **Download JSON Key File:**
    - After creating the service account, click on its email address.
    - Go to the "Keys" tab.
    - Click "Add Key" > "Create new key."
    - Select "JSON" as the key type and click "Create."
    - A JSON file will be downloaded to your computer. Rename this file to `google_sheets_credentials.json` and place it in the root directory of your `SmartLeadGen` project.

4.  **Share Your Google Sheet with the Service Account:**
    - Create a new Google Sheet (or use an existing one) where you want the data to be exported. Name it `Lead Generation Data` as specified in `bot.py`.
    - Open the Google Sheet, click the "Share" button.
    - In the "Share with people and groups" section, paste the email address of your service account (found in the downloaded JSON file under `client_email`).
    - Grant "Editor" permissions to the service account.
    - Click "Done."

### 4. Running the Bot

Once all dependencies are installed and Google Sheets API is configured, you can run the bot:

```bash
python3 bot.py
```

The bot will then prompt you to enter the Keyword and Location:

```
Enter Keyword (e.g., Fashion Showroom, Real Estate Agency, Dental Clinic, Restaurant, Interior Design, Tour Agency): 
Enter Location (e.g., Dhaka, Chittagong, Tangail, Bangladesh): 
```

## Important Notes

-   **Google Maps Selectors:** The HTML structure of Google Maps can change frequently. If the bot stops working correctly, you may need to inspect the Google Maps page and update the CSS selectors in `bot.py` (e.g., `scrollable_div_selector`, `business_cards`, `phone_tag`, `address_tag`, `website_tag`).
-   **Block Resistance:** For heavy usage, consider integrating proxy rotation, CAPTCHA solving services, or dedicated email finder APIs as suggested in the `bot.py` comments to enhance robustness and avoid IP blocking.
-   **Headless Mode:** By default, Playwright runs in headless mode (browser not visible). To see the browser actions for debugging, change `headless=True` to `headless=False` in `bot.py`.

## License

This project is licensed under the MIT License - see the `LICENSE` file for details.
