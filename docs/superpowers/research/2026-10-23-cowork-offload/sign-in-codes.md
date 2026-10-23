# Sign-in codes in email: research (handoff §4.2)

2026-10-23. Sources with dates are in SOURCES-codes.md. Daniel's decision (QUESTIONS.md A3) stands; this file only checks it.

## Findings

### 1. Length, digits, expiry, attempts
- 6 digits, numeric only, is the common email-code format. NIST SP 800-63-3B allows a secret of at least 20 bits of entropy (6 decimal digits is about 20 bits) if failed attempts are rate-limited, each secret works once, and an out-of-band secret expires within 10 minutes. 5 minutes and 3 attempts are inside every limit.
- OWASP's MFA cheat sheet says codes of 8 digits or more are recommended where usability allows, plus short life, single use, strict attempt limits, and a new code replacing the old one on resend. It gives no fixed lifetime.
- The plan's guess bound (3 tries per code, so at most 3 in a million per issued code) is sound. 8 digits stays a one-constant change if the auth reviewer wants more margin.
- NIST 800-63-3 says email "SHALL NOT" be used as an out-of-band authenticator, because email does not prove possession of a device. That applies to MFA at high assurance. For a first-factor sign-in code that replaces a password at a low-stakes study app, it is a known and accepted trade, the same as the existing link. OWASP lists the same weakness (the mailbox is the security). I read the 2017 text; I did not read the newer SP 800-63B-4, so check it before quoting NIST to anyone as current.

### 2. autocomplete="one-time-code"
- MDN documents the value ("a code received via ... SMS, email, or authenticator application") and warns against turning autocomplete off on these fields.
- Use it with `inputmode="numeric"`, which the plan already does (§2.4). One input, not six boxes; split boxes break autofill and paste.
- This attribute is what lets Safari offer the code above the keyboard. It is necessary but, per an Apple developer-forum thread (Nov 2023 onward), not always enough: developers report the attribute present and Mail still not offering the code (see 4).

### 3. WebOTP and the origin-bound line
- The line `@torah.centralreform.org #123456` is defined only for SMS. The WebOTP spec (WICG draft, April 2021) and the origin-bound-codes spec (WICG draft, March 2021) say nothing about email. Neither is a W3C standard.
- I found no email client that reads an origin-bound line. Do not add it to the email: it would not trigger anything, it repeats the code, and it makes the email look odd.
- WebOTP's JavaScript API (`navigator.credentials.get({otp})`) is Chromium on Android, SMS only. Not relevant to email.

### 4. How Apple Mail and Safari offer an emailed code
What is documented or reported:
- Since iOS 17 / iPadOS 17 / macOS Sonoma 14 (Sept 2023), Safari offers codes that arrive in Apple Mail, not only Messages. The mail account has to be set up in the Mail app on that device. Keeping Mail open helped one reviewer; it is not a stated requirement. Auto-delete of used codes is an optional setting (Settings, Passwords, Password Options).
- Safari shows the code as a suggestion over the keyboard when a field is marked one-time-code (or Safari recognizes it as a code field) and a code has recently arrived.

What I could not confirm, because Apple does not document it:
- The exact detection rule. No Apple source says the email needs the word "code" near the number, whether the subject counts, or whether HTML versus plain text matters. The only Apple engineer reply I found asks developers to file Feedback with the .eml. Treat anything more specific as unverified.
- One developer-forum report (Nov 2023): identical code worked from one site and failed on another, and the only difference was that the failing site sent from a different domain than the site's own host. This suggests Apple may weigh sender-domain match with the site. Unconfirmed; one report.
- Whether a Home Screen (standalone) web app gets the Mail code suggestion. I found no source either way. Test it on a real phone.

Safe construction, given the gaps:
- Plain text or very simple HTML.
- The 6 digits written together on their own line (no spaces, no dashes, no bold-in-image), with the word "code" in the same line or the line before.
- No other 6-digit number anywhere in the email, and nothing like a long digit run in the link text. (A random link token is fine as a URL.)
- Code in the body only, not the subject (the plan already does this). The subject can be words only.
- Send from an address on the CRC domain that matches the site family (centralreform.org), and keep SPF/DKIM clean.

### 5. Gmail's copy-code chip
- Gmail for Android and iOS shows a "Copy code" button on a card under the subject when an email contains a verification code (reported Sept 2026; also seen in the inbox preview, less reliably). Google does not publish the detection rule. It does not offer the code to the keyboard.
- Same construction as above is the best bet. A sender of the CRC kind (low volume, plain text) may or may not get the chip; this cannot be forced.

### 6. Relay phishing ("read me your code") and wording
- Nothing technical stops a person from being talked into reading a code aloud or typing it on a fake page. OWASP: email and SMS codes are phishable, "although short-lived". Our binding cookie and 5-minute life do not prevent it either (plan §2.8 item 5 says so; keep that).
- What helps is wording that does three things: names the only place the code is used, says that nobody from the organization will ask for it, and says not to read or give it to anyone. Naming the app by name works better than "anyone", because the scam script usually says "I'm from support".
- The code is also fine to mention as one-time and short-lived, so a late caller has less to work with.

## Check of the decided wording

Decided lines:
1. "Open this link to sign in: {link}"
2. "Or enter this code in the CRC Torah app: {code}"
3. "The link and the code work once, for 5 minutes."
4. "No one from CRC will ever ask you for this code. Don't read it to anyone or type it anywhere but CRC Torah."
5. "If you did not request this message, you can ignore it."
Button: "Email me a sign-in link".

**Confirmed.** Lines 3 and 4 are good anti-relay wording: they name the organization, say nobody will ask, and say not to read it out or enter it elsewhere. Nothing in them is a tone problem.

Concrete points, none blocking:
- **Line 2 placement.** Fine for Apple and Gmail as far as anything is documented: "code" and the digits are on the same line, early in the email. Build note for the executor: render `{code}` as plain digits with no spaces or dashes, and keep it the only 6-digit number in the email. If the real-phone check shows Mail not offering the code, the first thing to try is putting the code alone on its own line after "Or enter this code in the CRC Torah app:".
- **"the CRC Torah app".** People who opened the email on a laptop and use the site in a browser will read "app" as the site. Acceptable. If Daniel wants it exact, "in CRC Torah" matches line 4's closing words.
- **"work once".** True for each separately. Per plan §2.7 using the link does not burn the code, and the reverse, for the remaining minutes. The line does not promise otherwise, so it is honest. A security reviewer may prefer using either one to cancel both; that is a code decision, not wording.
- **Line 4 length.** It is two sentences in one line; in the plain-text body, keep it as its own paragraph so it is not lost under line 3.
- **Subject.** Not decided. Keep it words-only with no digits (for example "Your sign-in link for CRC Torah"), as the plan already says.
- **No WebOTP or origin-bound line.** Do not add one.
- **Open items only a phone can settle:** whether Mail offers the code to a Home Screen web app, and whether Gmail shows the chip for this sender. Add both to PHONE-CHECK.md.
