# Message to forward: two changes for torah.centralreform.org

Draft. Daniel sends this himself. Fill in [helper's name] before sending.

---

Subject: Two small changes for the CRC Torah web address

Hi [helper's name],

Thank you for helping with this. CRC Torah is moving to its own address, torah.centralreform.org. It needs two changes, one at SiteGround and one at Google. Together they take about five minutes. Nothing else is needed from you. The old address, beitmitzvah.centralreform.org, keeps working and will send visitors to the new one.

**Change 1: add one DNS record at SiteGround**

1. Sign in to SiteGround and open Site Tools for centralreform.org.
2. Go to Domain, then DNS Zone Editor.
3. Choose the record type CNAME and enter:
   - Name: `torah`
   - Resolves to: `cname.vercel-dns.com`
   - TTL: leave the default
4. Click Create.

Please don't change any other record. If a record named `torah` is already there, stop and tell me before doing anything else.

**Change 2: add two addresses to the Google sign-in**

1. Open https://console.cloud.google.com/apis/credentials, signed in with the Google account that owns the portal's sign-in. It is the same project that already serves beitmitzvah.centralreform.org.
2. Under OAuth 2.0 Client IDs, open the existing web client that lists `https://beitmitzvah.centralreform.org`. Please don't create a new client.
3. Under Authorized JavaScript origins, click Add URI and enter exactly:
   `https://torah.centralreform.org`
4. Under Authorized redirect URIs, click Add URI and enter exactly:
   `https://torah.centralreform.org/api/auth/callback/google`
5. Click Save. Leave every existing entry in place.

Enter both addresses with no slash at the end.

**How to confirm it worked**

- At SiteGround, the DNS Zone Editor list now shows one new row: torah, type CNAME, pointing to cname.vercel-dns.com.
- At Google, both new addresses appear in their lists after you click Save, and the old beitmitzvah entries are still there.
- Optional: the new address may not open yet. That is expected. I switch the site over once both changes are in.

**When you are done**

Please reply "torah steps done". If anything looks different from what I described, or you hit an error, reply with what you see (a screenshot is fine) and don't change anything else.

Thank you,
Daniel

---

# Second message, for v1.5.0: submit the sitemap to Google Search Console

Draft. Daniel sends this himself, only when v1.5.0 is live and the public pages are open to search engines. Fill in [helper's name] before sending. Before sending, open https://torah.centralreform.org/sitemap.xml and confirm it loads; if the path differs, use the path that loads.

---

Subject: One step for Google Search Console: the CRC Torah sitemap

Hi [helper's name],

CRC Torah's public pages are now open to search engines. One last step is to give Google the sitemap, so it finds the pages. It takes about five minutes.

1. Open https://search.google.com/search-console, signed in with the CRC Google account that manages the centralreform.org properties.
2. If `torah.centralreform.org` is not already listed, click Add property and choose URL prefix. Enter exactly `https://torah.centralreform.org` and click Continue. If Google asks you to verify ownership, the DNS record option is the simplest: it gives you a TXT record to add at SiteGround, under Domain, then DNS Zone Editor, the same place as the earlier `torah` record. Add it, wait a few minutes, and click Verify. If centralreform.org is already verified as a Domain property, this step is not needed.
3. In the left menu, open Sitemaps.
4. Under Add a new sitemap, enter `sitemap.xml` and click Submit.

**How to confirm it worked**

- The Sitemaps page lists `sitemap.xml` with the status Success. It can read Pending for a few minutes first.
- If it says Couldn't fetch, wait ten minutes and try once more. If it still fails, reply with a screenshot and don't change anything else.

**When you are done**

Please reply "sitemap submitted".

Thank you,
Daniel
