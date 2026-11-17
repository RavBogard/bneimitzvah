# Two steps for torah.centralreform.org

These two changes make **torah.centralreform.org** the address of CRC Torah. They take about five minutes. Nothing else is needed from you: the site is already set up for the address and switches over once both are in. The current address, beitmitzvah.centralreform.org, keeps working and sends visitors to the new one.

## 1. DNS record (SiteGround, centralreform.org)

1. Sign in to SiteGround and open **Site Tools** for centralreform.org.
2. Go to **Domain → DNS Zone Editor**.
3. Choose record type **CNAME** and fill in:

   | Field | Value |
   |---|---|
   | Name | `torah` |
   | Resolves to | `cname.vercel-dns.com` |
   | TTL | leave the default |

4. Click **Create**.

Don't change any other record. If a record named `torah` already exists, stop and tell Daniel.

## 2. Google sign-in (Google Cloud console)

1. Open <https://console.cloud.google.com/apis/credentials> with the Google account that owns the portal's sign-in. It's the same project as `beitmitzvah.centralreform.org`.
2. Under **OAuth 2.0 Client IDs**, open the existing web client that already lists `https://beitmitzvah.centralreform.org`. Don't create a new client.
3. Under **Authorized JavaScript origins**, click **Add URI** and enter exactly:
   `https://torah.centralreform.org`
4. Under **Authorized redirect URIs**, click **Add URI** and enter exactly:
   `https://torah.centralreform.org/api/auth/callback/google`
5. Click **Save**. Leave every existing entry in place.

Enter both URIs with no trailing slash.

## When both are done

Tell Daniel "torah steps done". Claude then checks the address and makes the switch.
