import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home, { generateMetadata } from "../../src/app/page";
import AcceptInvitationPage from "../../src/app/invitations/accept/page";
import AccountRoute from "../../src/app/account/page";
import SignInPage from "../../src/app/sign-in/page";
import { metadata as rootMetadata } from "../../src/app/layout";
import { frontDoorAccount, PortalEntry } from "../../src/components/portal/entry";
import { FrontDoor, ThisWeekView } from "../../src/components/portal/front-door/front-door";
import type { PublicWeek } from "../../src/components/portal/public-reading/api";

const home = async (query: Record<string, string> = {}) => renderToStaticMarkup(await Home({ searchParams: Promise.resolve(query) }));
const week = (date: string): PublicWeek => ({ date, parashah: "Noach", fetchedAt: 0, listening: { pocketTorah: false },
  torah: { kind: "torah", ranges: ["Genesis 6:9-11:32"], verseCount: 153, pages: [] },
  haftarah: { kind: "haftarah", ranges: ["Isaiah 54:1-55:5"], verseCount: 22, pages: [] } });

test("the home is CRC Torah's front door: This week, then the Beit Mitzvah door, then Learn to lein", async () => {
  const markup = await home();
  expect(markup).toContain('>CRC Torah</a>');
  expect(markup).not.toContain("CRC Beit Mitzvah");
  const week = markup.indexOf('id="this-week-title"'), beit = markup.indexOf('data-door="beit-mitzvah"'), learn = markup.indexOf('data-door="learn"');
  expect(week).toBeGreaterThan(-1);
  expect(beit).toBeGreaterThan(week);
  expect(learn).toBeGreaterThan(beit);
  expect(markup).toContain(">This Shabbat</p>");
  expect(markup).toContain('<a class="button-start" href="/read">Lein</a>');
  // Study opens the same reading in the Study lens.
  expect(markup).toContain('href="/read?lens=study">Study</a>');
  expect(markup).toContain('id="beit-mitzvah-title"');
  expect(markup).toContain(">Your readings</h2>");
  expect(markup).toContain(">Save the readings you’re working on, mark verses, keep notes. Beit Mitzvah students and families find their assigned reading and tutor here too.</p>");
  expect(markup).toContain('id="learn-title"');
  expect(markup).toContain(">Learn to lein</h2>");
  expect(markup).toContain("Hear the phrases, then lein a verse of this week&#x27;s reading.");
  expect(markup).toMatch(/href="\/learn"[^>]*>Start<\/a>/);
  expect(markup).toContain('href="/trope-chart">Trope chart</a>');
  // While access is checked the Beit Mitzvah door says so and holds its height; the sign-in form is not on the home at all.
  expect(markup).toContain('data-door-state="loading"');
  expect(markup).toContain("One moment while we check your access.");
  expect(markup).not.toContain('id="entry-title"');
  expect(markup).not.toContain('name="email"');
  // The footer is the layout's one footer, not the home's (signed-in-shell.test.ts); the home draws none of its own.
  expect(markup).not.toMatch(/<footer\b/);
  // The earlier single-purpose entry copy is gone from the home, and no pep talk arrived with the doors.
  expect(markup).not.toContain("Open your reading");
  expect(markup).not.toMatch(/!<|!\s/);
  expect(markup.match(/<h1\b/g)).toHaveLength(1);
});

test("the home's metadata names CRC Torah and describes the three doors; every page stays noindex", async () => {
  const metadata = await generateMetadata({ searchParams: Promise.resolve({}) });
  expect(metadata.title).toBe("CRC Torah");
  expect(metadata.description).toBe("Lein, learn to lein, and study the weekly Torah and haftarah at Central Reform Congregation");
  expect(metadata.referrer).toBe("strict-origin-when-cross-origin");
  expect((await generateMetadata({ searchParams: Promise.resolve({ token: "synthetic-private" }) })).referrer).toBe("no-referrer");
  expect(rootMetadata.title).toBe("CRC Torah");
  expect(rootMetadata.robots).toEqual({ index: false, follow: false });
});

test("while This week loads it shows one quiet skeleton line, and Lein and Study already work", () => {
  const markup = renderToStaticMarkup(createElement(ThisWeekView, { state: { date: "2026-10-24", status: "loading" } }));
  expect(markup.match(/data-skeleton/g)).toHaveLength(1);
  expect(markup).toContain('<span class="sr-only">This week’s reading</span>');
  expect(markup).toContain('href="/read">Lein</a>');
  expect(markup).toContain('href="/read?lens=study">Study</a>');
  expect(markup).not.toMatch(/spinner|Loading/i);
});

test("when the reading call fails, This week says so plainly and Lein and Study still link to the reading", () => {
  for (const date of ["2026-10-24", null]) {
    const markup = renderToStaticMarkup(createElement(ThisWeekView, { state: { date, status: "failed" } }));
    expect(markup).toContain('id="this-week-title"');
    expect(markup).toMatch(/<h1 [^>]*id="this-week-title"[^>]*>This week’s reading<\/h1>/);
    expect(markup).not.toContain("data-skeleton");
    expect(markup).toContain('href="/read">Lein</a>');
    expect(markup).toContain('href="/read?lens=study">Study</a>');
    expect(markup.includes("Saturday, October 24, 2026")).toBe(date !== null);
  }
});

test("a loaded week shows the parashah at display scale with its date and both ranges", () => {
  const markup = renderToStaticMarkup(createElement(ThisWeekView, { state: { date: "2026-10-24", status: "ready", week: week("2026-10-24") } }));
  expect(markup).toMatch(/<h1 [^>]*id="this-week-title"[^>]*>Noach<\/h1>/);
  expect(markup).toContain('<time dateTime="2026-10-24">Saturday, October 24, 2026</time>');
  expect(markup).toContain('Torah <bdi dir="ltr">Genesis 6:9–11:32</bdi>');
  expect(markup).toContain('Haftarah <bdi dir="ltr">Isaiah 54:1–55:5</bdi>');
  const holiday = renderToStaticMarkup(createElement(ThisWeekView, { state: { date: "2026-10-24", status: "ready", week: { ...week("2026-10-24"), parashah: null } } }));
  expect(holiday).toMatch(/>This week’s reading<\/h1>/);
});

test("on a Saturday the home leads with the next Shabbat: its label, its own address for Lein and Study, and a way to the day's reading (1.9 N5)", () => {
  const markup = renderToStaticMarkup(createElement(ThisWeekView, { state: { date: "2026-10-31", status: "ready", week: week("2026-10-31"), next: true } }));
  expect(markup).toContain(">Next Shabbat</p>");
  expect(markup).not.toContain(">This Shabbat</p>");
  expect(markup).toContain('<time dateTime="2026-10-31">Saturday, October 31, 2026</time>');
  expect(markup).toContain('href="/read?date=2026-10-31">Lein</a>');
  expect(markup).toContain('href="/read?date=2026-10-31&amp;lens=study">Study</a>');
  expect(markup).toContain('href="/read">This Shabbat</a>');
  // Any other day: as before, and no second link.
  const plain = renderToStaticMarkup(createElement(ThisWeekView, { state: { date: "2026-10-24", status: "ready", week: week("2026-10-24") } }));
  expect(plain).toContain(">This Shabbat</p>");
  expect(plain).not.toContain("Next Shabbat");
  expect(plain).not.toContain('>This Shabbat</a>');
});

test("invitation and sign-in entry stay plain pages with no doors, even if asked for them; Account is its own list page", async () => {
  const pages = [
    renderToStaticMarkup(createElement(AcceptInvitationPage)),
    renderToStaticMarkup(createElement(PortalEntry, { invitation: true, frontDoor: true })),
    renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) })),
  ];
  for (const markup of pages) {
    expect(markup).not.toContain("data-door");
    expect(markup).not.toContain("Learn to lein");
    expect(markup).not.toContain("this-week-title");
    expect(markup).not.toContain('href="/read?lens=study"');
    expect(markup).toContain('<h2 id="entry-title"');
    expect(markup).toContain('>CRC Torah</a>');
  }
  expect(pages[0]).toContain("Join your congregation’s practice");
  expect(pages[0]).not.toContain('href="/read"');
  // The sign-in form is /sign-in alone: it no longer carries the reader button.
  expect(pages[1]).not.toContain("Read this week’s Torah and haftarah");
  const account = renderToStaticMarkup(createElement(AccountRoute));
  expect(account).not.toContain("data-door");
  expect(account).not.toContain('id="entry-title"');
  expect(account).toContain(">Account</h1>");
});

test("a signed-in account that is refused still gets the same site bar; the door itself offers Sign out", () => {
  expect(frontDoorAccount({ kind: "forbidden" })).toEqual({ kind: "task", signedIn: undefined });
  expect(frontDoorAccount({ kind: "unavailable" })).toEqual({ kind: "task", signedIn: false });
  expect(frontDoorAccount({ kind: "loading" })).toBeNull();
  expect(frontDoorAccount({ kind: "sign-in" })).toEqual({ kind: "sign-in" });
  expect(frontDoorAccount({ kind: "signed-in", summary: { membershipAvailable: true, roles: ["tutor"], saved: true, approver: false, sessionBinding: "A".repeat(43) } })).toEqual({ kind: "account", saved: true, roles: ["tutor"], count: null, pinned: null });
  const bar = (account: ReturnType<typeof frontDoorAccount>) => {
    const markup = renderToStaticMarkup(createElement(FrontDoor, { account, children: createElement("p", null, "Synthetic task") }));
    return markup.slice(markup.indexOf("<header"), markup.indexOf("</header>"));
  };
  const refused = bar(frontDoorAccount({ kind: "forbidden" }));
  expect(refused).toContain('>CRC Torah</a>');
  // The home's Sign in is a plain link to the sign-in page; there is no scroll-to-door behaviour or role-name label.
  expect(bar({ kind: "sign-in" })).toContain('href="/sign-in"');
  expect(bar({ kind: "sign-in" })).not.toContain("beit-mitzvah");
  expect(bar({ kind: "account", saved: false, roles: [], count: null, pinned: null })).toContain('href="/mine"');
});

test("Find a reading sits under the hero and above the doors, with the Coming up row holding its place while the calendar loads", async () => {
  const markup = await home();
  const week = markup.indexOf('id="this-week-title"'), find = markup.indexOf('data-testid="find-reading"'), beit = markup.indexOf('data-door="beit-mitzvah"');
  expect(find).toBeGreaterThan(week);
  expect(beit).toBeGreaterThan(find);
  expect(markup).toContain('data-place="home"');
  expect(markup).toMatch(/<label[^>]*>Find a reading<\/label>/);
  // The hero's Lein and Study stay, and the chips are placeholders until the calendar arrives.
  expect(markup).toContain('href="/read">Lein</a>');
  expect(markup).toContain('data-state="loading"');
});
