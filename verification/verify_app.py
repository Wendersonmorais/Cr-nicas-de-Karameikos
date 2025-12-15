from playwright.sync_api import sync_playwright

def verify_app_loads():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            print("Navigating to http://localhost:3002")
            page.goto("http://localhost:3002")

            # Wait for any content to load
            print("Waiting for content...")
            page.wait_for_selector("body", timeout=10000)

            # Wait a bit longer for JS to execute
            page.wait_for_timeout(2000)

            # Take a screenshot
            print("Taking screenshot...")
            page.screenshot(path="verification/app_loaded.png")
            print("Screenshot taken successfully.")
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_app_loads()
