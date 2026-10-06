# Admin → Infrastructure Dashboard

Admin-only view of Karya-AI's Azure deployment: availability, errors, cost and
DNS. Reached at **`/admin/azure`**.

Everything Azure-facing happens server-side. No credential, token or connection
string is ever sent to the browser, logged, or returned by an API.

---

## 1. What works without any new configuration

These need no Azure credentials and are live today:

| Section | Source |
|---|---|
| Backend health | HTTP probe of `${BACKEND_URL}/api/health` |
| Frontend health | HTTP probe of the Azure URL and the production domain |
| Database health | `mongoose.connection.db.admin().ping()` on the existing connection |
| Domain / DNS | `dns.lookup`, record queries, TLS certificate, HTTPS reachability |
| Application Insights | Existing `AZURE_APP_INSIGHTS_*` key |
| Recent errors | Application Insights |

## 2. What needs Azure credentials

| Section | Needs |
|---|---|
| Subscription status | ARM access |
| Cost, budget, forecast | ARM + Cost Management |
| Azure resource health | ARM |

Until those are set, each shows **"Unknown — not configured"** with the exact
missing variables and roles. Nothing is ever shown as healthy on missing data.

---

## 3. Environment variables

### Already present — do not duplicate

```
AZURE_APP_INSIGHTS_APP_ID      # used by the existing /api/admin/analytics/azure
AZURE_APP_INSIGHTS_API_KEY
FRONTEND_URL                   # also the source of the monitored domain list
```

### New, all optional — each unlocks one section

```
BACKEND_URL                    # public API base, e.g. https://<app>.azurewebsites.net
                               # without it, Backend Health reads "Unknown"
AZURE_STATIC_WEB_APP_URL       # the *.azurestaticapps.net URL, shown beside the domain
MONITORED_DOMAINS              # comma-separated extras; www/apex are derived from FRONTEND_URL
AZURE_MONTHLY_BUDGET           # a number in your Azure billing currency, for % used

AZURE_SUBSCRIPTION_ID
AZURE_RESOURCE_GROUP
AZURE_TENANT_ID                # service principal only
AZURE_CLIENT_ID                # service principal only
AZURE_CLIENT_SECRET            # service principal only — prefer Managed Identity
```

> Never place any of these in `NEXT_PUBLIC_*`. They are backend-only.

---

## 4. Azure authentication

Tried in this order:

1. **Managed Identity** — preferred. If the App Service has a system-assigned
   identity, Azure injects `IDENTITY_ENDPOINT` and `IDENTITY_HEADER` and no
   secret is stored anywhere.
2. **Service principal** — `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET`.
3. **Neither** — the Azure sections report "not configured".

### Enabling Managed Identity

App Service → Identity → System assigned → **On**. Then assign the roles below
to that identity. No secret to store or rotate.

### Required RBAC roles (least privilege — all read-only)

| Scope | Role | Enables |
|---|---|---|
| Subscription | **Reader** | Subscription state, resource inventory |
| Subscription | **Cost Management Reader** | Spend, breakdown, forecast |
| Resource group | **Reader** | Provisioning state |

Assign: Subscription → Access control (IAM) → Add role assignment → pick the
role → assign to the Managed Identity or service principal.

Application Insights uses its own API key (Application Insights → API Access),
which needs only **Read telemetry**.

---

## 5. API

All under `/api/admin/infrastructure`, all `protect` + `restrictTo('admin')`.
Anonymous → 401, non-admin → 403.

| Method | Path | Purpose |
|---|---|---|
| GET | `/overview?window=24h&force=true` | Everything in one response |
| GET | `/backend-health` | Backend probe on its own |
| GET | `/database-health` | MongoDB status |
| GET | `/errors?window=24h&kind=5xx` | Recent errors, filterable |
| GET | `/cost?days=30` | Cost for 7 / 30 / month |
| GET | `/config` | Which integrations are wired, roles needed |
| POST | `/refresh` | Clear the cache; next read is live |

`window`: `1h` `6h` `24h` `7d` `30d` · `kind`: `all` `4xx` `5xx`

---

## 6. Caching

Server-side, in-process, per subsystem (§21):

| Probe | TTL |
|---|---|
| Database | 30s |
| Backend / Frontend | 60s |
| App Insights | 3 min |
| Azure resources | 3 min |
| DNS | 5 min |
| Azure cost / subscription | 10 min |

The header shows **Last updated**; **Refresh now** clears the cache.

---

## 7. Status vocabulary

🟢 Healthy · 🟡 Warning · 🔴 Critical · ⚪ Unknown

**Unknown is never rendered as healthy.** If a probe cannot determine something,
it says so. There are no health scores or rankings.

---

## 8. Troubleshooting

**Everything Azure says "not configured"** — expected until §3's Azure variables
are set. The dashboard's config panel lists exactly which are missing.

**Backend Health says "Unknown"** — `BACKEND_URL` is not set.

**Domain shows Critical / NXDOMAIN** — the domain genuinely does not resolve.
Check registration and nameservers at your registrar. This is a real finding,
not a probe bug.

**Application Insights partially empty** — the card shows "N queries failed";
the App Insights API occasionally times out. Refresh.

**403 on the page** — the account lacks `isAdmin`.

**Cost says "temporarily unavailable"** — ARM reachable but the Cost Management
query failed, usually a missing **Cost Management Reader** role.

---

## 9. Not yet built

Stage 1 is read-only monitoring. Still to come:

- Alert engine with thresholds, deduplication and resolution (§15, §16, §18)
- Email notifications via the existing Mailgun setup (§17)
- Background monitoring job (§22)
- Audit log (§23)
- Azure budget creation from the UI (§7)

The dashboard surfaces problems when opened; it does not yet notify.
