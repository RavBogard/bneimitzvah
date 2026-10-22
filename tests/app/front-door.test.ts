import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home, { generateMetadata } from "../../src/app/page";
import AcceptInvitationPage from "../../src/app/invitations/accept/page";
import AccountPage from "../../src/app/account/page";
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
  expect(markup).toContain('aria-label="CRC Torah home">CRC Torah</a>');
  expect(markup).not.toContain("CRC Beit Mitzvah");
  const week = markup.indexOf('id="this-week-title"'), beit = markup.indexOf('data-door="beit-mitzvah"'), learn = markup.indexOf('data-door="learn"');
  expect(week).toBeGreaterThan(-1);
  expect(beit).toBeGreaterThan(week);
  expect(learn).toBeGreaterThan(beit);
  expect(markup).toContain(">This Shabbat</p>");
  expect(markup).toContain('<a class="button-start" href="/read">Lein</a>');
  // Study waits for the Study lens; until then nothing on the home links to it.
  expect(markup).not.toContain("lens=study");
  expect(markup).not.toContain(">Study</a>");
  expect(markup).toContain('id="beit-mitzvah-title"');
  expect(markup).toContain(">For students, families and tutors preparing a Beit Mitzvah.</p>");
  expect(markup).toContain('id="learn-title"');
  expect(markup).toContain(">Learn to lein</h2>");
  expect(markup).toContain('href="/trope-chart">Open the trope chart</a>');
  // The existing sign-in task sits inside the Beit Mitzvah door, a level under the door's own heading.
  expect(markup.indexOf('<h3 id="entry-title"')).toBeGreaterThan(beit);
  expect(markup.indexOf('<h3 id="entry-title"')).toBeLessThan(learn);
  expect(markup).toContain("Checking your access");
  expect(markup).toContain("Central Reform Congregation");
  expect(markup).toContain("Your account and reading stay private.");
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

test("while This week loads it shows one quiet skeleton line, and Lein already works", () => {
  const markup = renderToStaticMarkup(createElement(ThisWeekView, { state: { date: "2026-10-24", status: "loading" } }));
  expect(markup.match(/data-skeleton/g)).toHaveLength(1);
  expect(markup).toContain('<span class="sr-only">This week’s reading</span>');
  expect(markup).toContain('href="/read">Lein</a>');
  expect(markup).not.toContain("lens=study");
  expect(markup).not.toMatch(/spinner|Loading/i);
});

test("when the reading call fails, This week says so plainly and Lein still links to the reading", () => {
  for (const date of ["2026-10-24", null]) {
    const markup = renderToStaticMarkup(createElement(ThisWeekView, { state: { date, status: "failed" } }));
    expect(markup).toContain('id="this-week-title"');
    expect(markup).toMatch(/<h1 [^>]*id="this-week-title"[^>]*>This week’s reading<\/h1>/);
    expect(markup).not.toContain("data-skeleton");
    expect(markup).toContain('href="/read">Lein</a>');
    expect(markup).not.toContain("lens=study");
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

test("invitation, sign-in and account entry stay plain pages with no doors, even if asked for them", async () => {
  const pages = [
    renderToStaticMarkup(createElement(AcceptInvitationPage)),
    renderToStaticMarkup(createElement(PortalEntry, { invitation: true, frontDoor: true })),
    renderToStaticMarkup(createElement(AccountPage)),
    renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) })),
  ];
  for (const markup of pages) {
    expect(markup).not.toContain("data-door");
    expect(markup).not.toContain("Learn to lein");
    expect(markup).not.toContain("this-week-title");
    expect(markup).not.toContain('href="/read?lens=study"');
    expect(markup).toContain('<h2 id="entry-title"');
    expect(markup).toContain('aria-label="CRC Torah home">CRC Torah</a>');
  }
  expect(pages[0]).toContain("Join your congregation’s practice");
  expect(pages[0]).not.toContain('href="/read"');
});

test("a signed-in account that is refused sees neither Sign in nor an account link in the app bar", () => {
  expect(frontDoorAccount({ kind: "forbidden" })).toBeNull();
  expect(frontDoorAccount({ kind: "loading" })).toBeNull();
  expect(frontDoorAccount({ kind: "sign-in" })).toEqual({ kind: "sign-in" });
  expect(frontDoorAccount({ kind: "signed-in", summary: { membershipAvailable: true, roles: ["tutor"], sessionBinding: "A".repeat(43) } })).toEqual({ kind: "account", role: "Tutor" });
  const bar = (account: ReturnType<typeof frontDoorAccount>) => {
    const markup = renderToStaticMarkup(createElement(FrontDoor, { account, onSignIn: () => {}, children: createElement("p", null, "Synthetic task") }));
    return markup.slice(markup.indexOf("<header"), markup.indexOf("</header>"));
  };
  const refused = bar(frontDoorAccount({ kind: "forbidden" }));
  expect(refused).toContain('aria-label="CRC Torah home">CRC Torah</a>');
  expect(refused).not.toContain("app-bar-account");
  expect(refused).not.toContain("Sign in");
  expect(refused).not.toContain('href="/account"');
  expect(bar({ kind: "sign-in" })).toContain(">Sign in</a>");
});
