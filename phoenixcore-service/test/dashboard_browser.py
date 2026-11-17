from pathlib import Path
from os import environ
from playwright.sync_api import sync_playwright
base = (Path(__file__).resolve().parents[2] / "phoenixcore" / "index.html").as_uri()
art_dir = Path(environ["PHOENIX_SCREENSHOTS"]) if "PHOENIX_SCREENSHOTS" in environ else None
if art_dir:
    art_dir.mkdir(parents=True, exist_ok=True)
def screenshot(page, name):
    if art_dir:
        page.screenshot(path=art_dir / name, full_page=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=environ.get("PHOENIX_CHROME"), headless=True)
    page=browser.new_page(viewport={"width":1280,"height":850},device_scale_factor=1)
    problems=[]
    page.on("pageerror", lambda e: problems.append(str(e)))
    page.goto(base)
    page.locator("#players .person").first.wait_for()
    assert page.locator("#players .person").count()==4
    screenshot(page,"directory.png")
    page.get_by_role("searchbox").fill("emberquill")
    assert page.locator("#players .person").count()==1
    page.locator("#players .person").filter(has_text="Ember Quill").click()
    assert page.locator(".char-card").count()==2
    page.locator(".char-card").filter(has_text="Rin").click()
    assert page.locator(".big-number").inner_text()=="10,000"
    screenshot(page,"sheet.png")
    page.get_by_role("link",name="Propose edit").click()
    page.get_by_label("Speed",exact=True).fill("Fast on rough terrain.")
    page.get_by_label("Reason for submission").fill("Revised after the training scene.")
    page.get_by_role("button",name="Send for approval").click()
    page.get_by_text("Requested changes", exact=True).wait_for()
    assert page.locator(".status").inner_text()=="Pending"
    assert page.get_by_role("button",name="Practice approve").count()==0
    page.get_by_role("link",name="View approved sheet").click()
    assert page.get_by_text("Fast on rough terrain.",exact=True).count()==0
    page.get_by_role("link", name="Requests", exact=True).click()
    page.locator(".request-row").filter(has_text="Rin").first.click()
    page.get_by_label("Practice role").select_option("owner")
    page.get_by_role("button",name="Practice approve").click()
    assert page.locator(".status").inner_text()=="Approved"
    page.get_by_role("link",name="View approved sheet").click()
    assert page.get_by_text("Fast on rough terrain.",exact=True).count()==1
    page.get_by_label("Practice role").select_option("judge")
    page.get_by_role("link",name="Judge a reward").click()
    page.get_by_label("Final BPL gain",exact=False).fill("12.5")
    page.get_by_label("Credits to award").fill("30")
    page.get_by_label("Gear to award").fill("Battle journal")
    page.get_by_label("Judgment and scene reference").fill("Gabe's example training scene.")
    assert "11,250" in page.locator("#estimate").inner_text()
    page.get_by_role("button",name="Submit award for approval").click()
    page.get_by_text("Requested changes",exact=True).wait_for()
    page.get_by_label("Practice role").select_option("owner")
    page.get_by_role("button",name="Practice approve").click()
    page.get_by_role("link",name="View approved sheet").click()
    assert page.locator(".big-number").inner_text()=="11,250"
    page.get_by_role("link",name="Bot settings").click()
    page.get_by_label("Currency display name").fill("Zeni")
    page.get_by_role("button",name="Save settings").click()
    assert page.get_by_text("Bot settings saved.",exact=True).count()==1
    page.get_by_label("Practice role").select_option("player")
    assert page.get_by_role("button",name="Save settings").count()==0
    page.get_by_role("link",name="Directory",exact=True).first.click()
    page.get_by_role("link",name="New character",exact=True).click()
    page.get_by_label("Character name").fill("Akira")
    page.get_by_label("Reason for submission").fill("Starting sheet")
    page.get_by_role("button",name="Send for approval").click()
    page.get_by_text("Requested changes",exact=True).wait_for()
    page.get_by_label("Practice role").select_option("owner")
    page.get_by_role("button",name="Practice decline").click()
    assert page.locator(".status").inner_text()=="Declined"
    phone=browser.new_page(viewport={"width":375,"height":812},device_scale_factor=1)
    phone.goto(base)
    phone.locator("#players .person").first.wait_for()
    assert phone.evaluate("document.body.scrollWidth <= innerWidth")
    screenshot(phone,"mobile.png")
    phone.get_by_role("link",name="New character").click()
    assert phone.evaluate("document.body.scrollWidth <= innerWidth")
    assert not problems,problems
    browser.close()
    print("Desktop and mobile dashboard verified. Search, member cards, sheets, edit, review, judge, wallet, settings and new sheet paths passed.")
