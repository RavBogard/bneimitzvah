import { resolveIdentity } from "../../lib/site/identity";
/**
 * The one footer landmark on every page (site navigation design, PR A). It is drawn once, by the root layout; a page never adds
 * its own. Line 1 is the congregation and the privacy promise; line 2 is Daniel's standard credit on CRC's origins; a fork shows it only as "Built on the CRC Beit Mitzvah app" when it sets CREDIT_UPSTREAM=true.
 */
export function SiteFooter() {
  const identity = resolveIdentity();
  return <footer className="site-footer">
    <p>{identity.name} · <a href="/about">About</a> · Your account stays private.</p>
    {identity.crc
      ? <p>A project of <a href="https://danielbogard.com" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Rabbi Daniel Bogard</a></p>
      : process.env.CREDIT_UPSTREAM === "true"
        ? <p data-testid="upstream-credit">Built on the <a href="https://github.com/RavBogard/bneimitzvah" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">CRC Beit Mitzvah app by Rabbi Daniel Bogard</a></p>
        : null}
  </footer>;
}
