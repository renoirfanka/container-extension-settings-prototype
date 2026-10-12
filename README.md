# Country rules settings
Per-country rules settings for a container extension request platform. A product case study by Reno Kartasasmita. [Open the live page](https://renoirfanka.github.io/container-extension-settings-prototype/)
## About this case study
This is a product case study. The scenario is anonymised and the country rules are illustrative.
The page is a front-end mock-up: no backend, and not connected to any real system. Data is kept in your browser only.
## The problem
Importers get a set number of free days to collect a container from the port, and can request paid extensions after that.
Each country's rules live in the code, so every new country or rule change needs a developer and a release.
## The idea
Move the rules that differ between countries into settings the operations team can change safely, with validation, a preview, a reason and a history.
Keep the calculation logic, and anything that touches money (such as payment order), in code.
## What to look at
**What can be configured** (six rules per country), **who can configure it** (operations admins edit, everyone else views), and **what prevents invalid settings** (inline validation, preview, required reason, history with restore, conflict check).
Tour: switch countries (Country D is incomplete) · edit a rule and watch the preview and day-by-day strip · try an invalid value · save with a reason and check History · press Restore · open the account menu and switch to the read-only viewer · open the page in two tabs and save in both to see the conflict message.
Add `?demo=1` to the address for extra tools, or `?reset=1` to reset all data.
## Assumptions
- Limits 1–30 (free days), 1–60 (longest extension) and 1–5 (extensions allowed) are assumed guardrails.
- Countries A, B and C count the arrival day as day 1 and every calendar day; Country D starts the day after arrival and skips Saturday and Sunday.
- The weekday rule applies to free days only. Changes apply to new requests only. A reason is required. Only operations admins can edit.
- Country D's longest extension and extensions allowed are left empty on purpose. Approval rules are stored, but the approval step itself is outside this mock-up. Payment order is not a setting.
## Run it
Open `index.html` in a browser. Run `node test.js` for the calculation checks.
