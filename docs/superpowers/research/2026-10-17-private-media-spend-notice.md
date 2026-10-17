# Private recording storage: costs and options — 2026-10-17

Status: **not approved or provisioned**. Daniel requested a better estimate rather than accepting the earlier $25 allowance. This revision supersedes that allowance and illustration. Deployment authority continues; new service spending waits for Daniel under MISSION. No store, paid writes, plan changes or shared billing/CDN changes have been made.

## Existing account, checked read-only

The linked Vercel team has active Pro with one existing $20/month platform seat, a shared $20 monthly infrastructure usage credit, and 1,000 GB of included Fast Data Transfer. Students are application users; they do not need paid Vercel team seats. Existing Neon Launch and shared Resend are separate, already authorized services.

The October usage snapshot through October 17 showed approximately $5.72 in non-platform gross usage across the entire Vercel team, with additional usage billed effectively zero. Its $16.38 total also contained $10.67 of prorated Pro subscription: treating all $16.38 as infrastructure usage would be wrong. This does not establish credit remaining at month end or how much transfer other CRC projects will use. Raw reports stay protected outside Git; only aggregate, nonpersonal figures appear here.

Vercel's [Pro plan](https://vercel.com/docs/plans/pro-plan) documents the credit. Actual account allowances agree with published limits. Estimates below show gross additional media usage **before** that credit. There is no separate $25 minimum Blob subscription in this proposal.

## Workload and retention

Model 34 simultaneously active students, 4.33 weeks/month. These are scenarios, not measured activity. Saved takes count; discarded local attempts cost no upload/storage. Each saved take is downloaded once for verification. Replays include tutor listening and count full-file equivalents.

The current canonical recorder produces mono 24 kHz, 16-bit PCM WAV: 2.88 MB/minute, about 28.8 MB for ten minutes. This is six times a 64 kbps compressed recording. Capture/verifier source exists but is not a deployed audio feature. A trustworthy conversion/validation path is required before promising compressed student storage; changing MIME is insufficient.

Retention is one year **after the ceremony**, not upload. An illustrative 18-month preparation period gives an average recording 21 months of retention (nine before ceremony plus twelve after). The table uses mature steady-state storage; initial months are smaller. Longer preparation, cohort size, deletion and saved-take behavior change the estimate.

Reference listening adds ten minutes/day on twenty days/month per student at 64 kbps in light/typical scenarios, thirty minutes/day in heavy, through the same private delivery path. Excluded: storage for an unmeasured reference archive, tutor uploads and future voice-model/GPU work. An additional GB of retained reference audio adds about $0.023/month on Blob or $0.015 on R2 before allowances, plus delivery/requests.

| Scenario | Saved takes/student/week | Replays/take | New PCM/month | Mature PCM stored | Total playback/month |
| --- | --- | --- | --- | --- | --- |
| Light | One × three minutes | Two | 1.27 GB | 26.7 GB | 5.81 GB |
| Typical | Three × three minutes | Three | 3.82 GB | 80.1 GB | 14.71 GB |
| Heavy | Five × ten minutes | Five | 21.20 GB | 445.2 GB | 115.79 GB |

## Same private-access model, different providers

Both options retain fresh portal authorization before disclosing student bytes. R2's free egress does not make Vercel response delivery/compute free.

| Monthly gross storage and byte transfer | Light | Typical | Heavy |
| --- | ---: | ---: | ---: |
| Private Vercel Blob + portal delivery | $1.74 | $4.76 | $32.26 |
| Private R2 Standard + portal delivery | $0.60 | $1.95 | $13.49 |

Calculated scenarios, not quotes or caps. Add function time, requests and incremental database usage. A **$5–8/month gross media planning range for typical Blob usage**, or **$2–5 for R2**, allows a modest unmeasured reserve. Vercel credit may absorb some/all of the Vercel portion depending on other projects; R2 bills separately. Measure synthetic acceptance traffic and actual usage before treating the reserve as validated. Heavy usage needs more budget.

Formulas use decimal GB, US East rates, direct browser uploads, no public response cache and available included Vercel transfer. U=monthly uploaded GB, S=mature stored GB, D=playback GB. Blob: `S × .023 + U × .11 + D × .17`, conservatively charging origin cache misses on every read. Rates: storage $0.023/GB-month, Blob transfer $0.05/GB, origin $0.06/GB on verification and both applicable origin/response legs on playback. Cache hits could lower this. [Blob rates](https://vercel.com/docs/vercel-blob/usage-and-pricing), [private delivery charges](https://vercel.com/docs/vercel-blob/private-storage#download-charges), [US East rates](https://vercel.com/docs/pricing/regional-pricing/iad1).

R2: `ceil(max(S − 10, 0)) × .015 + D × .06`, assuming its free allowances remain available. Standard storage $0.015/GB-month after 10 GB, rounded up per billing units, plus Vercel function-to-CDN origin transfer. Free R2 egress removes its own outbound fee; a third-party fetch does not add the extra Vercel CDN-to-function Blob-origin leg. Standard includes one million Class A and ten million Class B operations/month; scenarios are expected to fit, subject to chunking/other account use. [R2 pricing/rounding](https://developers.cloudflare.com/r2/pricing/), [Vercel transfer definitions](https://vercel.com/docs/manage-cdn-usage).

If other traffic exhausts Vercel's 1 TB allowance, add about `$0.15 × D` for playback responses plus overhead: $2.21 in typical, $17.37 in heavy. Optional Flat Rate CDN was not verified or changed; no assumptions about its coverage. Region, taxes, pricing and measurement granularity can change the bill.

At 64 kbps student storage, modeled typical storage/transfer falls to about $1.26/month on Blob or $0.37 on R2, before conversion/compute/requests/database work. Compression matters more at scale than small storage-rate differences. It remains an optimization to implement and verify.

## Options and recommendation

- **Private Vercel Blob:** simplest operation with the existing host, Production-only binding and rotating OIDC. The added invoice may be zero while shared credit remains. Recommended initial choice for fewer operational systems: plan $5–8 gross in an ordinary month and review forecasts above $10 before expanding usage. Neither a target nor an alert is a hard cap.
- **Private R2 Standard:** lowest modeled media bill and better heavy-use economics. Adds provider/billing setup, scoped server credentials/configuration and integration review. Ordinary modeled savings are about $3/month before Vercel credit; heavy savings about $19. Favor it if future bandwidth cost matters more than the extra setup.
- **Private Amazon S3:** mature choice if CRC already runs AWS. US East Standard storage is also $0.023/GB-month, with operations and potentially transfer charges. No demonstrated advantage over R2 here; adding AWS/IAM solely for this library adds operations. No legacy free-tier or unverified same-region exemption assumed. [Official AWS cost example](https://docs.aws.amazon.com/solutions/latest/automated-security-response-on-aws/cost.html).

A separate Cloudflare Worker delivery service could reduce Vercel response charges at larger scale but needs its own reviewed authorization architecture/cost model. Public buckets/reusable public links are not a student-recording cost shortcut.

## Concrete decision pending

Daniel can choose private Blob on the existing account, private R2 with separate setup, or leave storage unprovisioned while local work continues. Blob approval would create only `beitmitzvah-private-media` in `iad1`, connect Production only, use OIDC and begin with synthetic acceptance objects. It would not authorize shared billing/CDN changes, family audio before access/cleanup acceptance, invitations, real roster import or generated chant release. Any budget is a planning amount, not an enforced limit.
