from base64 import b64decode
from pathlib import Path
import json
import mimetypes
from urllib.parse import urlsplit
from os import environ
from playwright.sync_api import expect, sync_playwright
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
    def on_error(error):
        problems.append(str(error))
        print("Dashboard JS error:", error, flush=True)
    page.on("pageerror", on_error)
    page.goto(base)
    page.locator("#players .person").first.wait_for()
    expect(page.locator("#players .person")).to_have_count(4)
    screenshot(page,"directory.png")
    page.get_by_role("link",name="Community",exact=True).click()
    expect(page.get_by_role("heading",name="Community",exact=True)).to_be_visible()
    expect(page.get_by_text("Practice mode does not write server data.")).to_be_visible()
    page.get_by_role("link",name="Directory",exact=True).click()
    page.get_by_role("searchbox").fill("emberquill")
    expect(page.locator("#players .person")).to_have_count(1)
    page.locator("#players .person").filter(has_text="Ember Quill").click()
    expect(page.get_by_role("heading", name="Ember Quill", exact=True)).to_be_visible()
    expect(page.locator(".char-card")).to_have_count(2)
    page.locator(".char-card").filter(has_text="Rin").click()
    expect(page.locator(".big-number")).to_have_text("10,000")
    screenshot(page,"sheet.png")
    page.get_by_role("link",name="Propose edit").click()
    page.get_by_label("Speed",exact=True).fill("Fast on rough terrain.")
    page.get_by_label("Updated description").fill("Revised Speed on the sheet.")
    page.get_by_label("Approval requested").fill("Approve the speed correction.")
    page.get_by_label("Reason for update").fill("Revised after the training scene.")
    page.get_by_role("button",name="Send for approval").click()
    page.get_by_text("Requested changes", exact=True).wait_for()
    expect(page.locator(".status")).to_have_text("Pending")
    expect(page.get_by_role("button", name="Practice approve")).to_have_count(0)
    page.get_by_role("link",name="View approved sheet").click()
    expect(page.get_by_role("heading", name="Approved stats")).to_be_visible()
    expect(page.get_by_text("Fast on rough terrain.", exact=True)).to_have_count(0)
    page.get_by_role("link", name="Requests", exact=True).click()
    page.locator(".request-row").filter(has_text="Rin").first.click()
    page.get_by_label("Practice role").select_option("owner")
    page.get_by_role("button",name="Practice approve").click()
    expect(page.locator(".status")).to_have_text("Approved")
    page.get_by_role("link",name="View approved sheet").click()
    expect(page.get_by_text("Fast on rough terrain.", exact=True)).to_be_visible()
    page.get_by_label("Practice role").select_option("judge")
    page.get_by_role("link",name="Judge a reward").click()
    page.get_by_label("Final BPL gain",exact=False).fill("12.5")
    page.get_by_label("Zeni to award").fill("30")
    page.get_by_label("Gear to award").fill("Battle journal")
    page.get_by_label("Judgment and scene reference").fill("Gabe's example training scene.")
    expect(page.locator("#estimate")).to_contain_text("11,250")
    page.get_by_role("button",name="Submit award for approval").click()
    page.get_by_text("Requested changes",exact=True).wait_for()
    page.get_by_label("Practice role").select_option("owner")
    page.get_by_role("button",name="Practice approve").click()
    page.get_by_role("link",name="View approved sheet").click()
    expect(page.locator(".big-number")).to_have_text("11,250")
    page.get_by_role("link",name="Bot settings").click()
    page.get_by_label("Currency display name").fill("Zeni")
    page.get_by_role("button",name="Save settings").click()
    expect(page.get_by_text("Bot settings saved.", exact=True)).to_be_visible()
    page.get_by_label("Practice role").select_option("player")
    expect(page.get_by_role("button", name="Save settings")).to_have_count(0)
    page.get_by_role("link",name="Directory",exact=True).first.click()
    page.get_by_role("link",name="New Submission",exact=True).click()
    page.get_by_label("Character name").fill("Akira")
    page.get_by_label("Race / lineage",exact=True).select_option(label="Saiyan")
    paths=page.get_by_label("Path",exact=True)
    expect(paths).to_be_visible()
    expect(paths.locator("option").nth(1)).to_be_attached()
    path_name=paths.locator("option").nth(1).inner_text()
    paths.select_option(label=path_name)
    page.get_by_label("Race / lineage",exact=True).select_option(label="Other lineage…")
    expect(paths).to_have_value("")
    expect(paths.locator("option")).to_have_count(1)
    bio="The courier crossed the mountain before nightfall. "*180
    page.get_by_label("Lore / backstory").fill(bio)
    page.get_by_label("Personal strengths").fill("Patient\nPerceptive\nGenerous")
    page.get_by_label("Personal weaknesses").fill("Proud\nReckless\nDistrustful")
    page.get_by_label("Note for Gabe").fill("Starting sheet")
    page.get_by_role("button",name="Send for approval").click()
    page.get_by_text("Requested changes",exact=True).wait_for()
    lore=page.locator(".change-entry").filter(has=page.get_by_role("heading",name="Lore / backstory"))
    assert lore.locator(".prewrap").bounding_box()["width"] > page.locator("main").bounding_box()["width"]*.75
    expect(page.get_by_role("heading",name="Private staff checks")).to_have_count(0)
    page.get_by_label("Practice role").select_option("judge")
    expect(page.get_by_role("heading",name="Private staff checks")).to_be_visible()
    page.once("dialog",lambda d:d.accept("Please review the backstory."))
    page.get_by_role("button",name="Practice decline").click()
    expect(page.locator(".status")).to_have_text("Owner review")
    page.get_by_label("Practice role").select_option("owner")
    page.get_by_role("button",name="Uphold denial").click()
    expect(page.locator(".status")).to_have_text("Declined")
    expect(page.get_by_role("button",name="Delete archived request")).to_be_visible()
    page.get_by_label("Practice role").select_option("player")
    page.get_by_role("link", name="Directory", exact=True).first.click()
    page.get_by_role("link", name="New Submission", exact=True).click()
    kind=page.get_by_label("Submission type")
    expect(kind).to_have_value("create")
    page.get_by_label("Lore / backstory").fill("The caravan arrived at dawn.\n\nOnly Rin knew the road home.")
    for key,title in [("technique","Technique"),("race","Race"),("transformation","Transformation"),("training","Training Submission"),("edit","OC Update Request"),("item","Item")]:
        kind.select_option(key)
        expect(kind).to_have_value(key)
        if key in ("training","edit"):
            expect(page.locator("#submissionCharacter")).to_be_visible()
        else:
            expect(page.get_by_role("heading",name=title,exact=True)).to_be_visible()
    page.get_by_label("Item name").fill("Lantern compass")
    page.get_by_label("Description",exact=False).first.fill("A compass that finds the old road.")
    page.get_by_label("Effects / abilities").fill("Points toward the last sanctuary.")
    page.get_by_label("Drawbacks / limitations").fill("A single use each dawn.")
    page.get_by_label("Your current Intelligence").fill("9")
    page.get_by_label("Required Intelligence level").fill("21")
    expect(page.locator("[data-tier-feedback]")).to_contain_text("mentorship")
    screenshot(page,"item-submission.png")
    kind.select_option("create")
    expect(page.get_by_label("Lore / backstory")).to_have_value("The caravan arrived at dawn.\n\nOnly Rin knew the road home.")
    kind.select_option("item")
    expect(page.get_by_label("Item name")).to_have_value("Lantern compass")
    page.get_by_role("button",name="Send for approval").click()
    expect(page.locator(".status")).to_have_text("Pending")
    page.get_by_label("Practice role").select_option("owner")
    page.get_by_role("button",name="Practice approve").click()
    page.get_by_role("link",name="View approved design").click()
    expect(page.get_by_role("heading",name="Lantern compass")).to_be_visible()
    page.get_by_label("Practice role").select_option("player")
    page.get_by_role("link",name="Directory",exact=True).first.click()
    page.locator("#players .person").filter(has_text="Ember Quill").click()
    page.locator(".char-card").filter(has_text="Rin").click()
    page.get_by_role("link",name="Submit training").click()
    page.get_by_label("Training location").fill("Old Sadala arena")
    page.get_by_label("Training type").fill("Partnered")
    page.get_by_label("Training goals").fill("Keep a steady aura.")
    page.get_by_label("Formula & breakdown").fill("11,250 BPL plus 500 claimed.")
    page.get_by_label("Final PL / stat increase claimed").fill("+500 BPL and +2 Ki Control")
    page.get_by_role("button",name="Submit training claim").click()
    expect(page.locator(".status")).to_have_text("Awaiting Helper")
    page.get_by_label("Practice role").select_option("judge")
    page.get_by_label("Fixed BPL gain").fill("300")
    page.get_by_label("Other stat gains").fill("Ki Control +1")
    page.get_by_label("Judgment and scene reference").fill("Award 300 BPL and one control point.")
    page.get_by_role("button",name="Submit award for approval").click()
    expect(page.locator(".status")).to_have_text("Pending")
    page.get_by_label("Practice role").select_option("owner")
    screenshot(page,"training-review.png")
    page.get_by_role("button",name="Practice approve").click()
    page.get_by_role("link",name="View approved sheet").click()
    expect(page.locator(".big-number")).to_have_text("11,550")
    expect(page.get_by_role("heading",name="Training stats")).to_be_visible()
    page.get_by_label("Practice role").select_option("player")
    expect(page.get_by_role("heading",name="Posting preferences")).to_be_visible()
    page.get_by_label("Rin’s tag").fill("rin")
    page.locator(".tag-form").filter(has_text="Rin’s tag").get_by_role("button").click()
    expect(page.get_by_label("Rin’s tag")).to_have_value("rin")
    page.get_by_label("Post as").select_option(label="Rin")
    page.get_by_role("button",name="Save default").click()
    expect(page.get_by_label("Post as")).to_have_value("42cd18dc-4684-45fc-8817-e1c79ad1a9ee")
    page.goto(base+"#edit-42cd18dc-4684-45fc-8817-e1c79ad1a9ee")
    page.get_by_label("RP posting tag",exact=False).fill("[Night Courier]🔥")
    page.get_by_role("button",name="Save posting tag").click()
    expect(page.get_by_text("[Night Courier]🔥",exact=True)).to_be_visible()
    page.get_by_role("link",name="Propose edit").click()
    page.get_by_label("RP posting tag",exact=False).fill("courier2")
    gif=b64decode("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")
    page.get_by_label("Upload character portrait").set_input_files({"name":"portrait.gif","mimeType":"image/gif","buffer":gif})
    expect(page.get_by_text("Image ready to submit.")).to_be_visible()
    page.get_by_label("Updated description").fill("A new portrait and tag.")
    page.get_by_label("Approval requested").fill("Approve both changes.")
    page.get_by_label("Reason for update").fill("A new chapter.")
    page.get_by_role("button",name="Send for approval").click()
    expect(page.locator(".status")).to_have_text("Pending")
    expect(page.get_by_alt_text("Proposed artwork")).to_be_visible()
    page.get_by_role("link",name="View approved sheet").click()
    expect(page.get_by_text("[Night Courier]🔥",exact=True)).to_be_visible()
    # A newly attained form and its own portrait travel through owner review.
    page.get_by_role("link", name="Propose edit").click()
    page.get_by_label("Race / lineage", exact=True).select_option(label="Saiyan")
    page.get_by_label("Available forms").select_option("custom")
    page.get_by_role("button",name="Add form",exact=True).click()
    page.get_by_label("Form name",exact=True).fill("Awakening")
    page.get_by_label("Upload form portrait").set_input_files({"name":"awakening.gif","mimeType":"image/gif","buffer":gif})
    expect(page.get_by_text("Image ready to submit.")).to_be_visible()
    page.get_by_label("Updated description").fill("Gained Awakening.")
    page.get_by_label("Approval requested").fill("Approve this form and its portrait.")
    page.get_by_label("Reason for update").fill("Completed a trial.")
    page.get_by_role("button",name="Send for approval").click()
    expect(page.locator(".status")).to_have_text("Pending")
    page.get_by_label("Practice role").select_option("owner")
    page.get_by_role("button",name="Archive request").click()
    expect(page.get_by_role("link",name="Archived",exact=True)).to_have_attribute("aria-current","page")
    page.locator(".request-row").first.click()
    page.get_by_role("button",name="Restore request").click()
    page.locator(".request-row").first.click()
    page.get_by_role("button",name="Practice approve").click()
    page.get_by_role("link",name="View approved sheet").click()
    expect(page.get_by_text("Awakening",exact=True)).to_be_visible()
    page.get_by_role("link",name="Support Center",exact=True).click()
    expect(page.get_by_role("heading",name="Support Center",exact=True)).to_be_visible()
    expect(page.get_by_text("Practice mode does not create or transmit cases.")).to_be_visible()
    page.get_by_role("link",name="Giveaways",exact=True).click()
    expect(page.get_by_role("heading",name="Giveaways",exact=True)).to_be_visible()
    expect(page.get_by_text("Practice mode never awards Zeni or draws winners.")).to_be_visible()
    page.get_by_role("link",name="Directory",exact=True).click()

    phone=browser.new_page(viewport={"width":375,"height":812},device_scale_factor=1)
    phone.goto(base)
    phone.locator("#players .person").first.wait_for()
    assert phone.evaluate("document.body.scrollWidth <= innerWidth")
    screenshot(phone,"mobile.png")
    phone.get_by_role("link",name="New Submission").click()
    expect(phone.get_by_role("heading", name="New Submission")).to_be_visible()
    assert phone.evaluate("document.body.scrollWidth <= innerWidth")
    screenshot(phone,"mobile-submission.png")
    # Exercise the actual atlas and editor scripts on a same-origin fixture.
    web_root=Path(__file__).resolve().parents[2]
    edits={}
    def site(context, owner=False):
        def serve(route):
            url=urlsplit(route.request.url)
            if url.netloc!="codex.test":
                route.abort()
                return
            if url.path=="/api/codex/access":
                route.fulfill(json={"canEdit":owner})
            elif url.path=="/api/codex":
                if route.request.method=="GET":
                    route.fulfill(json={"entries":list(edits.values())})
                    return
                assert owner
                patch=route.request.post_data_json
                edits[patch["key"]]={"key":patch["key"],"revision":patch["revision"]+1,"fields":{**edits.get(patch["key"],{}).get("fields",{}),**patch["fields"]}}
                route.fulfill(json=edits[patch["key"]])
            elif url.path=="/api/support":
                if route.request.method=="GET":
                    cases=[{"id":"b21c01cb-3f65-4b16-9178-c9d247de983e","kind":"ticket",
                        "status":"Waiting for Staff","summary":"A rules clarification",
                        "assignedId":None,"sensitive":False,"anonymous":False},
                        {"id":"b21c01cb-3f65-4b16-9178-c9d247de983f","kind":"ticket",
                        "status":"Closed","summary":"Resolved issue","assignedId":None,
                        "sensitive":False,"anonymous":False}]
                    insights={"total":2,"active":1,"resolved":1,"awaitingStaff":1,
                        "openedLast7Days":2,"averageFirstStaffReplyHours":1.5,
                        "averageResolutionHours":2.0,
                        "feedback":{"responses":1,"average":4.0},
                        "workload":[{"staffId":"960000000000000003","total":2,"active":1,"resolved":1}]}
                    route.fulfill(json={"staff":owner,"owner":owner,
                        "stats":{"total":2,"open":1,"resolved":1} if owner else None,
                        "insights":insights if owner else None,
                        "templates":[{"id":"b31c01cb-3f65-4b16-9178-c9d247de983e",
                            "name":"account-help","body":"Hello {{member}}, welcome to {{case}}",
                            "revision":2,"active":True,"creatorId":"owner","updatedMs":1700000000000}] if owner else None,
                        "cases":cases})
                else: route.fulfill(json={"ok":True,"result":{"id":"b21c01cb-3f65-4b16-9178-c9d247de983e"}})
            elif url.path=="/api/support/search":
                items=[{"id":"b21c01cb-3f65-4b16-9178-c9d247de983e",
                    "kind":"ticket","status":"Waiting for Staff","summary":"A rules clarification"},
                    {"id":"b21c01cb-3f65-4b16-9178-c9d247de983f",
                    "kind":"ticket","status":"Closed","summary":"Resolved issue"}]
                term=url.query.lower()
                if "resolved" in term:items=items[1:]
                route.fulfill(json={"total":len(items),"page":1,"pages":1,"pageSize":25,"cases":items})
            elif url.path=="/api/support/templates":
                assert owner, "Saved replies require support staff."
                if route.request.method=="GET":route.fulfill(json={"templates":[]})
                else:
                    action=route.request.post_data_json.get("action")
                    route.fulfill(json={"result":{"id":"b31c01cb-3f65-4b16-9178-c9d247de983e",
                        "revision":3,"body":"Hello Convergence!","active":action!="archive"}})
            elif url.path=="/api/support/templates/b31c01cb-3f65-4b16-9178-c9d247de983e/history":
                assert owner
                route.fulfill(json={"history":[{"revision":2,"name":"account-help",
                    "body":"Hello {{member}}","active":True,"actorId":"owner",
                    "changedMs":1700000000000}]})
            elif url.path.startswith("/api/support/feedback/"):
                if route.request.method=="GET":
                    route.fulfill(json={"caseId":url.path.split("/")[-1],"closed":True,
                        "maySubmit":not owner,"feedback":None})
                else:route.fulfill(json={"recorded":True})
            elif url.path in ("/api/support/b21c01cb-3f65-4b16-9178-c9d247de983e",
                             "/api/support/b21c01cb-3f65-4b16-9178-c9d247de983f"):
                closed=url.path.endswith("983f")
                route.fulfill(json={"case":{"id":url.path.split("/")[-1],
                    "kind":"ticket","status":"Closed" if closed else "Waiting for Staff",
                    "summary":"Resolved issue" if closed else "A rules clarification",
                    "isStaff":owner,"sensitive":False,"assignedId":None},
                    "events":[{"type":"opened","text":"Could you explain the guideline?",
                               "createdMs":1700000000000,"authorId":"writer"}],
                    "feedback":{"maySubmit":closed and not owner,
                        "feedback":None}})
            elif url.path=="/api/community/roles":
                if route.request.method=="GET":
                    route.fulfill(json={"owner":owner,"enabled":True,"panels":[{
                        "id":"a31c01cb-3f65-4b16-9178-c9d247de983e",
                        "channelId":"1573908218260885614","title":"Member Badges",
                        "description":"Choose a role to display your interests.","style":"reactions",
                        "color":11000000,"imageUrl":"https://example.com/banner.png",
                        "active":True,"revision":3,"messageId":"920000000000000030",
                        "options":[{"roleId":"920000000000000006",
                          "label":"<img src=x onerror=window.roleInjection=true>",
                          "emoji":"🔥","recordedSelections":4,"position":0}]}]})
                else:
                    assert owner, "Role panel administration should be owner-only."
                    route.fulfill(json={"ok":True,"result":{"id":"a31c01cb-3f65-4b16-9178-c9d247de983e"}})
            elif url.path=="/api/economy/shops/sales":
                assert owner, "Shop revenue reports are restricted to configured staff."
                all_time={"receipts":"3","units":"5","zeni":"625","cashZeni":"375","bankZeni":"250"}
                last7={"receipts":"1","units":"1","zeni":"125","cashZeni":"125","bankZeni":"0"}
                last30={"receipts":"2","units":"3","zeni":"375","cashZeni":"125","bankZeni":"250"}
                route.fulfill(json={"generatedMs":1700000000000,"receiptCount":3,
                    "overall":{"all":all_time,"last7":last7,"last30":last30},
                    "shops":[{"id":"f21c01cb-3f65-4b16-9178-c9d247de983e","name":"Portal Store",
                        "all":all_time,"last7":last7,"last30":last30,
                        "topItems":[{"itemId":"e21c01cb-3f65-4b16-9178-c9d247de983e",
                            "name":"Guardian Potion","receipts":"3","units":"5","zeni":"625",
                            "cashZeni":"375","bankZeni":"250"}]}],
                    "recent":[{"receiptId":"fb1c01cb-3f65-4b16-9178-c9d247de983e",
                        "shopId":"f21c01cb-3f65-4b16-9178-c9d247de983e",
                        "itemId":"e21c01cb-3f65-4b16-9178-c9d247de983e",
                        "itemName":"Guardian Potion","characterId":"a1000000-0000-4000-8000-000000000001",
                        "quantity":1,"payment":"cash","totalZeni":"125","createdMs":1700000000000}]})
            elif url.path=="/api/economy/shops":
                if route.request.method=="GET":
                    route.fulfill(json={"staff":owner,"owner":owner,"items":[{
                        "id":"e21c01cb-3f65-4b16-9178-c9d247de983e","name":"Guardian Potion",
                        "description":"<img src=x onerror=window.unsafeShop=true>",
                        "kind":"consumable","basePrice":"100","revision":1}],
                        "npcOptions":[
                            {"id":"f4aa99d3-4a75-40c7-8737-adb4b7e31300","name":"King Azurik","portrait":""},
                            {"id":"f21c01cb-3f65-4b16-9178-c9d247de983f","name":"Master Orrin","portrait":""}],
                        "shops":[{"id":"f21c01cb-3f65-4b16-9178-c9d247de983e",
                        "name":"Portal Store","description":"A traveling merchant.",
                        "ownerName":"King Azurik","ownerNpcId":"f4aa99d3-4a75-40c7-8737-adb4b7e31300",
                        "npcAvailable":True,"ownerPortrait":"","kind":"general",
                        "status":"open","revision":3,"channels":[],
                        "stock":[{"itemId":"e21c01cb-3f65-4b16-9178-c9d247de983e","price":"125","remaining":7}]}]})
                else:
                    assert owner, "Only approved staff should save shop definitions."
                    route.fulfill(json={"ok":True,"result":{"id":"f21c01cb-3f65-4b16-9178-c9d247de983e"}})
            elif url.path.startswith("/api/economy/inventory/"):
                route.fulfill(json={"characterId":url.path.split("/")[-1],"items":[]})
            elif url.path=="/api/giveaways":
                if route.request.method=="GET":
                    route.fulfill(json={"staff":owner,"owner":owner,"guild":"950522987646418964",
                        "channels":["1573908218260885614"],"channelRevision":1,"characters":[],
                        "enteredGiveawayIds":[],"giveaways":[{
                          "id":"c21c01cb-3f65-4b16-9178-c9d247de983e","title":"An Autumn Celebration",
                          "description":"A special community gift.","prizeKind":"manual","prizeText":"Custom event title",
                          "zeniAmount":None,"status":"active","entries":4,"winnerCount":1,
                          "startsMs":1700000000000,"endsMs":4700000000000,
                          "channelId":"1573908218260885614","winners":[]}]})
                else: route.fulfill(json={"ok":True})
            elif url.path=="/api/giveaways/c21c01cb-3f65-4b16-9178-c9d247de983e/participants":
                assert owner, "Only Owner should request participant identities."
                second="page=2" in url.query
                filter_withdrawn="filter=withdrawn" in url.query
                member={
                    "userId":"800000000000000003","username":"rinplayer",
                    "displayName":"<img src=x onerror=window.unsafeRoster=true>",
                    "avatarUrl":None,"memberStatus":"current","active":True,
                    "joinedMs":1700000000000,"updatedMs":1700000000000,
                    "booster":True,"currentEligible":True,"currentTickets":3,
                    "drawTickets":None,"drawEligible":None,"wins":[]}
                returned=({"userId":"800000000000000004","username":"otheruser",
                    "displayName":"Former participant","avatarUrl":None,
                    "memberStatus":"left","active":False,
                    "joinedMs":1700000000001,"updatedMs":1700000000010,
                    "booster":None,"currentEligible":None,"currentTickets":None,
                    "drawTickets":None,"drawEligible":None,"wins":[]} if second or filter_withdrawn else member)
                route.fulfill(json={"giveawayId":"c21c01cb-3f65-4b16-9178-c9d247de983e",
                    "filter":"withdrawn" if filter_withdrawn else "all","page":2 if second else 1,
                    "pages":1 if filter_withdrawn else 2,"pageSize":25,
                    "total":1 if filter_withdrawn else 26,"active":25,"withdrawn":1,
                    "hasDrawSnapshot":False,"participants":[returned]})
            elif url.path=="/api/giveaways/c21c01cb-3f65-4b16-9178-c9d247de983e":
                route.fulfill(json={"giveaways":[{
                    "id":"c21c01cb-3f65-4b16-9178-c9d247de983e","title":"An Autumn Celebration",
                    "description":"A special community gift.","prizeKind":"manual","prizeText":"Custom event title",
                    "zeniAmount":None,"status":"active","entries":4,"winnerCount":1,
                    "startsMs":1700000000000,"endsMs":4700000000000,
                    "channelId":"1573908218260885614","winners":[]}]})
            elif url.path=="/api/automod":
                assert owner, "Automod evidence requires staff authorization."
                if route.request.method=="GET":
                    route.fulfill(json={"owner":True,"policy":{"revision":2,"policy":{
                        "enabled":True,"ownerAlerts":False,"invites":True,
                        "blockedHosts":["scam.example"],"duplicateThreshold":3,
                        "duplicateWindowSeconds":30,"mentionThreshold":2,
                        "excludedChannels":[],"excludedRoles":[]}},
                        "incidents":{"total":1,"page":1,"pages":1,"hits":[{
                            "id":"e61c01cb-3f65-4b16-9178-c9d247de983e",
                            "message_id":"930000000000000050","user_id":"930000000000000005",
                            "channel_id":"930000000000000006","rule":"invite",
                            "excerpt":"Look at https://discord.gg/example",
                            "created_ms":1700000000000}]},
                        "history":[{"revision":2,"actor_id":"owner","changed_ms":1700000000000}]})
                else:
                    payload=route.request.post_data_json
                    if payload.get("action")=="preview":
                        route.fulfill(json={"ok":True,"result":{"rules":["invite"],"recorded":False,"enforced":False}})
                    else:route.fulfill(json={"ok":True,"result":{"revision":3}})
            elif url.path=="/api/moderation":
                assert owner, "Non-moderators must not receive private moderation cases."
                if route.request.method=="GET":
                    route.fulfill(json={"total":2,"page":1,"pages":1,"cases":[{
                        "id":"b61c01cb-3f65-4b16-9178-c9d247de983e","target_id":"940000000000000004",
                        "actor_id":"owner","kind":"ban","reason":"Member was given a timed restriction.",
                        "created_ms":1700000000000,"active":1,"sanction_status":"applied",
                        "until_ms":4700000000000,"last_error":"","source_message_id":None,
                        "character_id":None},
                        {"id":"b61c01cb-3f65-4b16-9178-c9d247de983f","target_id":"940000000000000005",
                        "actor_id":"owner","kind":"warn","reason":"Please follow the community rules.",
                        "created_ms":1700000000000,"active":1,"sanction_status":None,
                        "until_ms":None,"last_error":"","source_message_id":None,
                        "character_id":None}]})
                else:route.fulfill(json={"ok":True,"result":{"caseId":"b61c01cb-3f65-4b16-9178-c9d247de983e","status":"applied"}})
            elif url.path=="/api/moderation/case/b61c01cb-3f65-4b16-9178-c9d247de983e":
                assert owner
                route.fulfill(json={"record":{"id":"b61c01cb-3f65-4b16-9178-c9d247de983e"},
                    "events":[{"actor_id":"owner","event":"discord-applied",
                        "detail":"Manual ban confirmed by Discord.","occurred_ms":1700000000000}]})
            elif url.path=="/api/community":
                if route.request.method=="GET":
                    route.fulfill(json={"staff":owner,"owner":owner,"modules":{"tags":True,"suggestions":True},
                        "tags":[{"name":"visitor-guide","body":"Welcome to Convergence.","revision":2,
                            "title":"Convergence Visitor Guide","color":15000000,
                            "imageUrl":"https://example.org/guide.png",
                            "presentationRevision":1,
                            "buttons":[{"label":"Read Codex","url":"https://example.org/codex"}]}],
                        "suggestions":[{"id":"b21c01cb-3f65-4b16-9178-c9d247de983e","title":"More RP arenas","body":"We could use another practice arena.","status":"Under Review","staff_response":"On the roadmap.","upvotes":2,"downvotes":0}],"proposals":[]})
                else: route.fulfill(json={"ok":True})
            elif url.path=="/api/state":
                if route.request.headers.get("authorization")!="Bearer fixture":
                    route.fulfill(status=401,json={"error":"Sign in again"})
                else:
                    route.fulfill(json={"actor":{"id":"owner" if owner else "writer","isOwner":owner,"isPlayer":True,"isJudge":owner},"canModerate":owner,"players":[],"characters":[],"requests":[],"catalogue":[],"settings":None,"posting":{},"currency":"Credits"})
            elif url.path=="/phoenixcore/config.js":
                route.fulfill(content_type="text/javascript",body="window.PHOENIXCORE_API='https://codex.test';")
            else:
                path=web_root/url.path.lstrip("/")
                if path.is_file():
                    route.fulfill(path=str(path),content_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream")
                else: route.fulfill(status=404,body="")
        context.route("**/*",serve)
        if owner: context.add_init_script("sessionStorage.setItem('pc:/phoenixcore/:session','fixture')")
        tab=context.new_page()
        tab.on("pageerror",on_error)
        return tab
    owner_tab=site(browser.new_context(),True)
    owner_tab.goto("https://codex.test/worlds.html#planet-earth")
    expect(owner_tab.locator("#modalTitle")).to_have_text("Planet Earth")
    owner_tab.get_by_role("link",name="Location Guild(s)").click()
    expect(owner_tab.get_by_text("No guilds have been listed",exact=False)).to_be_visible()
    owner_tab.get_by_role("button",name="Close details").click()
    owner_tab.get_by_role("button",name="Edit Mode",exact=True).click()
    owner_tab.get_by_role("button",name="Explore Planet Earth",exact=True).click()
    owner_tab.get_by_role("link",name="Location Guild(s)").click()
    owner_tab.get_by_role("button",name="Add guild").click()
    owner_tab.get_by_label("Name",exact=True).fill("Earth Watch")
    owner_tab.get_by_label("Leadership").fill("The elected wardens")
    owner_tab.get_by_role("button",name="Publish changes").click()
    owner_tab.get_by_role("link",name="Earth Watch").click()
    expect(owner_tab.get_by_text("The elected wardens")).to_be_visible()
    item_page="https://codex.test/worlds.html#planet-earth/items"
    owner_tab.goto(item_page)
    owner_tab.get_by_role("button",name="Add mystical item").click()
    owner_tab.get_by_label("Name",exact=True).fill("First Bell")
    owner_tab.get_by_label("Abilities").fill("Marks the start of the trial.")
    owner_tab.get_by_role("button",name="Publish changes").click()
    owner_tab.get_by_role("link",name="First Bell").click()
    expect(owner_tab.get_by_text("Marks the start of the trial.")).to_be_visible()
    item_link=owner_tab.url
    guest=site(browser.new_context(viewport={"width":390,"height":844}))
    guest.goto(item_link)
    expect(guest.get_by_text("Marks the start of the trial.")).to_be_visible()
    expect(guest.get_by_role("button",name="Edit Mode",exact=True)).to_have_count(0)
    guest.get_by_role("button",name="Close details").click()
    guest.get_by_role("button",name="Choose your Codex theme").click()
    expect(guest.locator(".theme-choice")).to_have_count(30)
    guest.locator('[data-theme-id="forest"]').click()
    guest.reload()
    expect(guest.locator("html")).to_have_attribute("data-codex-theme","forest")
    overflow=guest.evaluate("""() => [...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1 && el.getBoundingClientRect().width).map(el=>[el.tagName,el.className,el.getBoundingClientRect().right]).slice(0,10)""")
    assert guest.evaluate("document.body.scrollWidth <= innerWidth"),overflow
    guest.goto("https://codex.test/worlds.html#planet-sadala/guilds")
    expect(guest.get_by_text("No guilds have been listed",exact=False)).to_be_visible()
    owner_tab.goto("https://codex.test/worlds.html")
    owner_tab.get_by_role("button",name="Edit content").click()
    owner_tab.get_by_label("Section",exact=True).select_option("themes")
    owner_tab.get_by_role("dialog",name="Edit Codex content").get_by_role("combobox",name="Entry",exact=True).select_option("themes/forest")
    owner_tab.get_by_label("Name",exact=True).fill("Forest Green")
    owner_tab.get_by_role("button",name="Publish changes").click()
    expect(owner_tab.get_by_role("button",name="Exit Edit Mode",exact=True)).to_be_visible()
    guest.goto("https://codex.test/worlds.html")
    guest.get_by_role("button",name="Choose your Codex theme").click()
    expect(guest.locator('[data-theme-id="forest"]')).to_have_text("Forest Green✓")
    screenshot(owner_tab,"atlas-owner.png")
    screenshot(guest,"atlas-themes-mobile.png")
    remembered=browser.new_context()
    first=site(remembered)
    first.goto("https://codex.test/phoenixcore/index.html")
    first.evaluate("sessionStorage.setItem('pc:/phoenixcore/:session','fixture')")
    first.reload()
    expect(first.get_by_role("button",name="Sign out")).to_be_visible()
    first.close()
    again=remembered.new_page()
    again.goto("https://codex.test/phoenixcore/index.html")
    expect(again.get_by_role("button",name="Sign out")).to_be_visible()
    again.goto("https://codex.test/phoenixcore/index.html#community")
    expect(again.get_by_role("heading",name="Community",exact=True)).to_be_visible()
    expect(again.get_by_role("heading",name="Convergence Visitor Guide",exact=True)).to_be_visible()
    expect(again.get_by_role("link",name="Read Codex")).to_have_attribute("href","https://example.org/codex")
    assert again.locator("#community-rich-tag-form").count()==0
    expect(again.get_by_role("heading",name="More RP arenas",exact=True)).to_be_visible()
    again.goto("https://codex.test/phoenixcore/index.html#support")
    expect(again.get_by_role("heading",name="Support Center",exact=True)).to_be_visible()
    expect(again.get_by_text("A rules clarification",exact=False)).to_be_visible()
    expect(again.get_by_role("heading",name="Search accessible cases")).to_be_visible()
    assert again.get_by_role("heading",name="Staff saved replies").count()==0
    assert again.get_by_role("heading",name="Support operations").count()==0
    again.locator('a.request-row[href="#support-b21c01cb-3f65-4b16-9178-c9d247de983e"]').first.click()
    expect(again.get_by_role("heading",name="SupportCase",exact=False)).to_be_visible()
    expect(again.get_by_text("Could you explain the guideline?")).to_be_visible()
    again.goto("https://codex.test/phoenixcore/index.html#support-b21c01cb-3f65-4b16-9178-c9d247de983f")
    expect(again.get_by_role("heading",name="Optional case feedback")).to_be_visible()
    expect(again.locator('#support-feedback-form select[name="rating"]')).to_have_count(1)
    again.goto("https://codex.test/phoenixcore/index.html#roles")
    expect(again.get_by_role("heading",name="Role Panels",exact=True)).to_be_visible()
    again.get_by_role("link",name="Member Badges",exact=False).click()
    expect(again.get_by_role("heading",name="Member Badges",exact=True)).to_be_visible()
    assert again.get_by_role("heading",name="Owner controls").count()==0
    assert again.locator('img[src="x"]').count()==0
    again.goto("https://codex.test/phoenixcore/index.html#shops")
    expect(again.get_by_role("heading",name="Shops & Inventory",exact=True)).to_be_visible()
    again.get_by_role("link",name="Portal Store",exact=False).click()
    expect(again.get_by_role("heading",name="Portal Store",exact=True)).to_be_visible()
    expect(again.get_by_text("125 Zeni",exact=False)).to_be_visible()
    assert again.get_by_role("heading",name="Staff controls").count()==0
    assert again.get_by_role("heading",name="Sales overview").count()==0
    assert again.get_by_role("heading",name="Shop sales report").count()==0
    assert again.locator('img[src="x"]').count()==0
    assert again.get_by_role("link",name="Moderation").count()==0
    assert again.get_by_role("link",name="AutoMod").count()==0
    again.goto("https://codex.test/phoenixcore/index.html#giveaways")
    expect(again.get_by_role("heading",name="Giveaways",exact=True)).to_be_visible()
    expect(again.get_by_text("An Autumn Celebration",exact=False)).to_be_visible()
    again.get_by_role("link",name="An Autumn Celebration",exact=False).click()
    expect(again.get_by_role("heading",name="An Autumn Celebration",exact=True)).to_be_visible()
    expect(again.get_by_text("Custom event title",exact=False)).to_be_visible()
    expect(again.get_by_role("button",name="Enter giveaway")).to_be_visible()
    assert again.evaluate("sessionStorage.getItem('pc:/phoenixcore/:verifier')") is None
    owner_dashboard=site(browser.new_context(viewport={"width":390,"height":844}),True)
    owner_dashboard.goto("https://codex.test/phoenixcore/index.html#giveaways")
    owner_dashboard.get_by_role("link",name="An Autumn Celebration",exact=False).click()
    expect(owner_dashboard.get_by_role("heading",name="Participant directory · Owner only")).to_be_visible()
    expect(owner_dashboard.get_by_text("rinplayer",exact=False)).to_be_visible()
    expect(owner_dashboard.get_by_text("3 tickets currently eligible",exact=False)).to_be_visible()
    assert owner_dashboard.locator('img[src="x"]').count()==0, "Discord display name was injected as HTML"
    owner_dashboard.get_by_role("button",name="Next",exact=True).click()
    expect(owner_dashboard.get_by_text("Former participant",exact=False)).to_be_visible()
    expect(owner_dashboard.get_by_text("Page 2 of 2")).to_be_visible()
    owner_dashboard.get_by_role("button",name="Withdrawn",exact=True).click()
    expect(owner_dashboard.get_by_text("Former participant",exact=False)).to_be_visible()
    expect(owner_dashboard.get_by_text("Page 1 of 1")).to_be_visible()
    assert owner_dashboard.evaluate("document.body.scrollWidth <= innerWidth")
    screenshot(owner_dashboard,"giveaway-owner-participants-mobile.png")
    owner_dashboard.goto("https://codex.test/phoenixcore/index.html#roles")
    expect(owner_dashboard.get_by_role("heading",name="Create a role panel")).to_be_visible()
    owner_dashboard.get_by_role("link",name="Member Badges",exact=False).click()
    expect(owner_dashboard.get_by_role("heading",name="Owner controls")).to_be_visible()
    expect(owner_dashboard.get_by_text("4 recorded selections",exact=False)).to_be_visible()
    expect(owner_dashboard.locator('#rolepanel-style-form')).to_have_count(1)
    expect(owner_dashboard.locator('#rolepanel-emoji-form')).to_have_count(1)
    expect(owner_dashboard.locator(".role-panel-option small").first).to_contain_text("🔥")
    assert owner_dashboard.evaluate("document.body.scrollWidth <= innerWidth")
    screenshot(owner_dashboard,"role-panels-owner-mobile.png")
    owner_dashboard.goto("https://codex.test/phoenixcore/index.html#community")
    expect(owner_dashboard.get_by_role("heading",name="Styled informational tags")).to_be_visible()
    owner_dashboard.locator('#rich-tag-picker').select_option("visitor-guide")
    expect(owner_dashboard.locator('#community-rich-tag-form')).to_have_count(1)
    expect(owner_dashboard.locator('#community-rich-tag-form input[name="title"]')).to_have_value("Convergence Visitor Guide")
    assert owner_dashboard.evaluate("document.body.scrollWidth <= innerWidth")
    screenshot(owner_dashboard,"community-rich-tags-owner-mobile.png")
    owner_dashboard.goto("https://codex.test/phoenixcore/index.html#support")
    expect(owner_dashboard.get_by_role("heading",name="Support operations")).to_be_visible()
    expect(owner_dashboard.get_by_role("heading",name="Search accessible cases")).to_be_visible()
    expect(owner_dashboard.get_by_role("heading",name="Staff saved replies")).to_be_visible()
    owner_dashboard.locator('#support-template-picker').select_option("b31c01cb-3f65-4b16-9178-c9d247de983e")
    expect(owner_dashboard.locator('#support-template-form input[name="name"]')).to_have_value("account-help")
    owner_dashboard.goto("https://codex.test/phoenixcore/index.html#support-b21c01cb-3f65-4b16-9178-c9d247de983e")
    expect(owner_dashboard.locator('[data-support-template-insert]')).to_have_count(1)
    assert owner_dashboard.evaluate("document.body.scrollWidth <= innerWidth")
    screenshot(owner_dashboard,"support-owner-operations-mobile.png")
    owner_dashboard.goto("https://codex.test/phoenixcore/index.html#moderation")
    expect(owner_dashboard.get_by_role("heading",name="Moderation",exact=True)).to_be_visible()
    expect(owner_dashboard.get_by_role("heading",name="Record a manual moderation action")).to_be_visible()
    expect(owner_dashboard.get_by_text("Member was given a timed restriction.")).to_be_visible()
    owner_dashboard.get_by_role("button",name="Inspect audit").first.click()
    expect(owner_dashboard.get_by_role("heading",name="Case audit",exact=False)).to_be_visible()
    expect(owner_dashboard.get_by_text("Manual ban confirmed by Discord.")).to_be_visible()
    assert owner_dashboard.evaluate("document.body.scrollWidth <= innerWidth")
    screenshot(owner_dashboard,"moderation-owner-mobile.png")
    owner_dashboard.goto("https://codex.test/phoenixcore/index.html#automod")
    expect(owner_dashboard.get_by_role("heading",name="AutoMod",exact=True)).to_be_visible()
    expect(owner_dashboard.get_by_role("heading",name="Owner: detection policy")).to_be_visible()
    expect(owner_dashboard.get_by_role("heading",name="Private incident history")).to_be_visible()
    expect(owner_dashboard.get_by_text("Look at https://discord.gg/example")).to_be_visible()
    owner_dashboard.locator('#automod-preview-form input[name="channelId"]').fill("930000000000000006")
    owner_dashboard.locator('#automod-preview-form textarea[name="content"]').fill("https://discord.gg/example")
    owner_dashboard.locator('#automod-preview-form button').click()
    expect(owner_dashboard.get_by_text("Simulation:",exact=False)).to_be_visible()
    assert owner_dashboard.evaluate("document.body.scrollWidth <= innerWidth")
    screenshot(owner_dashboard,"automod-owner-mobile.png")
    owner_dashboard.goto("https://codex.test/phoenixcore/index.html#shops")
    expect(owner_dashboard.get_by_role("heading",name="Sales overview")).to_be_visible()
    expect(owner_dashboard.get_by_text("625 Zeni",exact=False)).to_be_visible()
    expect(owner_dashboard.get_by_role("heading",name="Staff: create a shop")).to_be_visible()
    create_keeper=owner_dashboard.locator('#shop-create-form select[name="shopkeeperChoice"]')
    expect(create_keeper.locator('option')).to_have_count(4)
    expect(create_keeper.locator('option[value="f4aa99d3-4a75-40c7-8737-adb4b7e31300"]')).to_have_text("King Azurik")
    expect(create_keeper.locator('option[value="f21c01cb-3f65-4b16-9178-c9d247de983f"]')).to_have_text("Master Orrin")
    expect(create_keeper.locator('option[value="custom"]')).to_have_text("Custom Entry — enter a new name")
    expect(owner_dashboard.locator('#shop-create-form input[name="ownerName"]')).to_be_hidden()
    create_keeper.select_option("custom")
    expect(owner_dashboard.locator('#shop-create-form input[name="ownerName"]')).to_be_visible()
    owner_dashboard.locator('#shop-create-form input[name="ownerName"]').fill("A Custom Merchant")
    create_keeper.select_option("f4aa99d3-4a75-40c7-8737-adb4b7e31300")
    expect(owner_dashboard.locator('#shop-create-form input[name="ownerName"]')).to_be_hidden()
    owner_dashboard.get_by_role("link",name="Portal Store",exact=False).click()
    expect(owner_dashboard.get_by_role("heading",name="Staff controls")).to_be_visible()
    expect(owner_dashboard.get_by_role("heading",name="Shopkeeper",exact=True)).to_be_visible()
    expect(owner_dashboard.get_by_role("heading",name="Shop sales report")).to_be_visible()
    expect(owner_dashboard.get_by_role("heading",name="Most purchased items")).to_be_visible()
    expect(owner_dashboard.get_by_role("heading",name="Recent purchases")).to_be_visible()
    expect(owner_dashboard.locator('#shop-keeper-form select[name="shopkeeperChoice"]')).to_have_value("f4aa99d3-4a75-40c7-8737-adb4b7e31300")
    expect(owner_dashboard.get_by_role("button",name="Remove from shop")).to_be_visible()
    owner_dashboard.locator('#shop-keeper-form select[name="shopkeeperChoice"]').select_option("custom")
    owner_dashboard.locator('#shop-keeper-form input[name="ownerName"]').fill("The Wandering Shopkeeper")
    expect(owner_dashboard.locator('#shop-keeper-form input[name="ownerName"]')).to_be_visible()
    expect(owner_dashboard.get_by_role("heading",name="Add stock or update price")).to_be_visible()
    assert owner_dashboard.evaluate("document.body.scrollWidth <= innerWidth")
    screenshot(owner_dashboard,"shop-owner-mobile.png")
    assert not problems,problems
    browser.close()
    print("Desktop and mobile verified, including templates, judgments, attained forms, archives, forum preferences, public atlas links, role-gated editing and all 30 themes.")
