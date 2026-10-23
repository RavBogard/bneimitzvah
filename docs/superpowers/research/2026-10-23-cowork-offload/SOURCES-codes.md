# Sources for sign-in-codes.md (read 2026-10-23)

Primary
- NIST SP 800-63B (63-3 text), out-of-band and look-up secrets, https://pages.nist.gov/800-63-3/sp800-63b.html. Published 2017, revised 2020. Newer SP 800-63B-4 exists; not read.
- OWASP Multifactor Authentication Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html. Living document, current as fetched.
- MDN, autocomplete attribute (one-time-code), https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete. Living document.
- W3C WICG, WebOTP API, https://wicg.github.io/web-otp/. Draft Community Group Report, 13 April 2021. Not a standard.
- W3C WICG, Origin-bound one-time codes delivered via SMS, https://wicg.github.io/sms-one-time-codes/. Draft, 24 March 2021. SMS only.
- Apple Support, Safari on Mac, SMS passcodes, https://support.apple.com/guide/safari/ibrwa4a6c6c6/mac. Messages only; Mail not mentioned.
- Apple Developer Forums, "Autofill verification codes received in Mail", https://developer.apple.com/forums/thread/738690. Started Nov 2023. Only Apple reply asks for Feedback with an .eml. No documented rule.

Secondary (less authoritative)
- Techlicious, Safari autofills codes from Mail and Messages, 1 Nov 2023, https://www.techlicious.com/blog/effortless-logins-safaris-new-feature-auto-fills-verification-codes/
- OS X Daily, autofill security codes from Mail, 14 Feb 2024, https://osxdaily.com/2024/02/14/how-autofill-security-code-mail-iphone-ipad-mac/ (iOS 17 / macOS 14 or newer; account set up in Mail).
- Android Central, Gmail Copy Code button, 21 Sept 2026, https://www.androidcentral.com/apps-software/gmail/gmail-for-android-now-finds-your-verification-codes
- Macworld, why Apple SMS codes end in "@apple.com #123456" (SMS, not email), https://www.macworld.com/article/606996/apple-verification-code.html (seen in search results; not opened).

Not found
- No Apple or Google document stating the detection rule for emailed codes, or Home Screen web app behavior for it.
- 1Password community thread (14 Sept 2026) on PWA login autofill is about password filling, not codes; not used.
