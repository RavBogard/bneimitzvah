/**
 * The one footer landmark on every page (site navigation design, PR A). It is drawn once, by the root layout; a page never adds
 * its own. Line 1 is the congregation and the privacy promise; line 2 is Daniel's standard credit, as in his other apps.
 */
export function SiteFooter() {
  return <footer className="site-footer">
    <p>Central Reform Congregation · Your account and reading stay private.</p>
    <p>A project of <a href="https://danielbogard.com" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Rabbi Daniel Bogard</a></p>
  </footer>;
}
