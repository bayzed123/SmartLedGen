# SmartLeadGen Web Dashboard
|SmartLeadGen|(https://smartledgen-kjugtxpleaim2e6doabffl.streamlit.app/)
## Overview

The SmartLeadGen Web Dashboard is an interactive, mobile-responsive application built with Streamlit, designed to provide a user-friendly interface for the lead generation bot. It automates the process of finding potential digital marketing clients by scraping Google Maps and business websites, displaying real-time progress, and exporting data.
## |licences|(LicenseRef-PEP 639)
## Features

-   **Interactive Control Panel:** User-friendly input fields for "Keyword" and "Location" to dynamically control the scraping process.
-   **Live Status Console:** Real-time logging of the bot's activities, including scraping progress and email extraction status.
-   **Live Data Preview:** A dynamic data table that updates in real-time as new leads are identified and processed.
-   **CSV Export:** Instant download of collected leads as a CSV file directly from the dashboard.
-   **Google Sheets Integration:** Seamlessly appends all collected data to a specified Google Sheet in real-time.
-   **Mobile Responsive:** Designed to work efficiently and look great on various devices, including mobile phones.

## Technical Stack

-   **Python 3.x**
-   **Streamlit:** For building the interactive web dashboard.
-   **Playwright:** For robust browser automation and web scraping from Google Maps.
-   **BeautifulSoup4:** For parsing HTML content and extracting data from business websites.
-   **gspread:** For interacting with the Google Sheets API.
-   **pandas:** For efficient data handling and display.
-   **re (Regex):** For advanced email pattern matching.

## Setup and Installation

Follow these steps to set up and run the SmartLeadGen Web Dashboard locally.

### 1. Clone the Repository

```bash
git clone https://github.com/bayzed123/SmartLeadGen.git
cd SmartLeadGen
```

### 2. Install Dependencies

It's highly recommended to use a virtual environment.

```bash
python3 -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`
pip install -r requirements.txt
playwright install  # Install Playwright browser binaries
```

### 3. Google Sheets API Credentials Setup

To enable the bot to write data to your Google Sheet, you need to set up Google Sheets API credentials. This involves creating a service account and sharing your Google Sheet with it.

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
    - Create a new Google Sheet (or use an existing one) where you want the data to be exported. Name it `Lead Generation Data` as specified in `app.py`.
    - Open the Google Sheet, click the "Share" button.
    - In the "Share with people and groups" section, paste the email address of your service account (found in the downloaded JSON file under `client_email`).
    - Grant "Editor" permissions to the service account.
    - Click "Done."

### 4. Running the Web Dashboard Locally

Once all dependencies are installed and Google Sheets API is configured, you can run the Streamlit app:

```bash
streamlit run app.py
```

This will open the web dashboard in your browser, typically at `http://localhost:8501`.

## Deployment to Streamlit Community Cloud (Free)

Streamlit Community Cloud offers a free and easy way to deploy your Streamlit applications.

1.  **Fork the Repository:** Ensure your `SmartLeadGen` repository is public on GitHub.
2.  **Sign Up/Log In:** Go to [Streamlit Community Cloud](https://streamlit.io/cloud) and sign up or log in.
3.  **Deploy an App:** Click on "New app" and connect your GitHub account.
4.  **Select Repository:** Choose the `SmartLeadGen` repository.
5.  **Configure Deployment:**
    -   **Repository:** `your-username/SmartLeadGen`
    -   **Branch:** `main`
    -   **Main file path:** `app.py`
    -   **Python version:** Select a compatible Python version (e.g., 3.9 or 3.10).
    -   **Advanced settings:** Ensure you have a `packages.txt` file in your root directory with `chromium` listed. This helps Streamlit Cloud install the necessary system-level browser dependencies for Playwright.
6.  **Deploy:** Click "Deploy!" Streamlit will build and deploy your app.

**Important Note for Playwright on Streamlit Community Cloud:**
Playwright requires browser binaries. To ensure these are available on Streamlit Community Cloud, you need to include a `packages.txt` file in your repository's root directory containing `chromium`. This instructs Streamlit Cloud to install the necessary system dependencies. Additionally, the `playwright install` command in your local setup ensures the Python Playwright library can find and use these browsers.

## Deployment to Render (Free Tier Available)

Render provides a platform to host web services, including Streamlit apps.

1.  **Sign Up/Log In:** Go to [Render](https://render.com/) and sign up or log in.
2.  **New Web Service:** Click "New" > "Web Service."
3.  **Connect GitHub:** Connect your GitHub account and select the `SmartLeadGen` repository.
4.  **Configure Deployment:**
    -   **Name:** `smartleadgen-dashboard` (or your preferred name)
    -   **Root Directory:** `/`
    -   **Runtime:** `Python 3`
    -   **Build Command:** `pip install -r requirements.txt && playwright install`
    -   **Start Command:** `streamlit run app.py --server.port $PORT --server.enableCORS false --server.enableXsrfProtection false`
    -   **Instance Type:** Choose a free tier instance if available.
5.  **Create Web Service:** Click "Create Web Service."

**Important Note for Playwright on Render:**
Render's build environment will execute `playwright install`, which should download the necessary browser binaries. Ensure your `requirements.txt` is correct and `playwright install` is part of your build command. If you encounter issues, consider adding a `Dockerfile` for more explicit control over the environment and Playwright setup.

## Troubleshooting Common Issues

-   **`CachedWidgetWarning`:** This warning occurs when Streamlit widget commands are used inside functions decorated with `@st.cache_data` or `@st.cache_resource`. To fix this, ensure all Streamlit UI elements (like `st.text_area`, `st.dataframe`) are called directly in the main script flow or within functions that are *not* cached. In `app.py`, `get_google_sheet_client` no longer uses `@st.cache_resource` to avoid this, and log updates are handled in the main UI loop.
-   **Playwright Browser Launch Errors (e.g., `Error: This app has encountered an error.`):** This typically means Playwright cannot find or launch the browser executable. On cloud platforms like Streamlit Community Cloud or Render, ensure that:
    -   You have `playwright install` in your build command (for Render) or that `packages.txt` with `chromium` is present (for Streamlit Cloud).
    -   The environment has sufficient resources (memory, CPU) to run a browser.
    -   If running locally, ensure `playwright install` has been executed in your virtual environment.
-   **Streamlit UI Freezing:** Long-running operations (like web scraping) can block Streamlit's single-threaded event loop, making the UI unresponsive. In `app.py`, the scraping logic is now run in a separate `threading.Thread` to prevent this. The UI is updated asynchronously by modifying `st.session_state` and using `st.rerun()`.
-   **Google Maps Selectors:** The HTML structure of Google Maps can change frequently. If the bot stops working correctly, you may need to inspect the Google Maps page using your browser's developer tools and update the CSS selectors in `app.py` (e.g., `scrollable_div_selector`, `business_cards`, `phone_tag`, `address_tag`, `website_tag`).

## License

This project is licensed under the MIT License - see the `LICENSE` file for details.
