Not sent: Daniel decided on 2026-10-23 not to send a courtesy note.

# Courtesy note to Sefaria (unused draft)

**Send through:** the engineering contact form at https://developers.sefaria.org/page/contact-us. It is a form, not an email, so paste the text below. If Daniel prefers email, Sefaria's public contact address is their general address.

**Subject:** A small congregational site reading from your API

---

Hello,

I'm a rabbi at Central Reform Congregation in St. Louis. We've built CRC Torah, a free, noncommercial site where our members and b'nei mitzvah students prepare to chant and study the week's Torah and haftarah. It's at beitmitzvah.centralreform.org now and is moving to torah.centralreform.org.

The site reads text, translations, links and commentary live from your public API:

- Each request is made when someone opens a reading. Nothing crawls.
- We cache at our CDN: commentary for 30 days, links for a week, and missing texts for an hour.
- The traffic is about one congregation's worth.
- Every text we show carries its edition, its licence and "via Sefaria", with a link back.

I wanted you to know we're here. Is there anything you'd like us to do differently, such as request pacing or an identifying User-Agent? If you ever need us to slow down, a reply here reaches me.

Thank you for building the library this rests on.

{Daniel's name}
Central Reform Congregation, St. Louis
