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
