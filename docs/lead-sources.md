# Lead Sources

Where enquiries come from, who may use or manage each source, and what is known about the integrations feeding it. Code: `backend/app/services/lead_sources.py` (rules), `backend/app/services/marketing.py` (analytics, attribution helpers), `frontend/src/pages/LeadSources/`.

## Rules the server enforces

| Rule | Behaviour |
| --- | --- |
| Scope | A source is **Common** (no branch) or **Branch-specific**. Branch of an enquiry/lead is never derived from its source. |
| Visibility | Everyone who works with leads/enquiries can *choose* common sources plus their own branch's. Seeing the Lead Sources screen needs the Lead Sources permission. |
| Who manages | Super Admin: common and any branch's sources. A branch user with the Lead Sources edit permission: only their own branch's. |
| Duplicates | Names compare ignoring case, spaces and punctuation. A common name is unique across everything; a branch name is unique inside its branch and cannot reuse a common name; two branches may use the same name. Enforced by partial unique indexes (`uq_lead_sources_common_name`, `uq_lead_sources_branch_name`). |
| Delete | Blocked (409) when any enquiry, lead, deal, customer or campaign uses the source, and for the standard sources. Deactivate instead. |
| Rename / deactivate | Records keep pointing at the source id; the readable name follows a rename; an inactive source is not offered on new records but old records keep it. |
| Scope change | A source already used by CRM records cannot move between Common and a branch. |
| Categories | Stored in `app_settings` (`lead_source_categories`); defaults are only the starting list. `POST /lead-sources/categories` adds one without a code change. |

## Standard catalogue

Seeded idempotently by `python -m scripts.seed` (`lead_sources.seed_defaults`): Paid Advertising, Website, Social Media and Messaging, Offline, Referral and Internal. Sources from the earlier list are renamed in place (same id) where the meaning is identical (Contact Form → Website Contact Form, Google → Google Ads, Phone → Phone Call, Partner → Partner Referral, Existing Customer Referral → Customer Referral). Older sources that the new list replaces are switched off only when nothing uses them. The old names still resolve through `SOURCE_ALIASES`.

## Integration readiness

`lead_source_integrations` stores **metadata only**: platform, account / form name, mapped branch, status, last successful sync, latest error. It never stores credentials, tokens or webhook secrets — those belong in the secure backend configuration of the Integrations & Routing module.

* A person (Super Admin) can record a mapping and switch it on or off. Doing so never sets *Connected*.
* Status is `Not Connected` (default, and when there is no mapping), `Connected`, `Error` or `Inactive`. A source with several mappings shows Error if any active one fails, else Connected if any works, else Inactive if all are off.
* The Integrations module reports results through two service functions (not exposed over HTTP):
  * `lead_sources.record_sync_success(db, mapping_id)` — sets Connected and stamps `last_sync_at`.
  * `lead_sources.record_sync_error(db, mapping_id, message)` — sets Error with a short summary.
* Enquiries it creates should set `created_via = "Integration"` and take their branch from the mapping's `mapped_branch`, not from the source.

## Attribution on enquiries and leads

All optional: `source_category` (snapshot, server-owned), `ad_name`, `ad_id`, `landing_page`, `utm_source/medium/campaign/content`, `referring_employee_id` (an employee of the record's branch), `created_via` (Manual / Conversion / Import / Integration, server-owned). Enquiry → lead conversion copies them unchanged and sets the lead's `created_via` to Conversion; the original enquiry is not modified.

## Endpoints

`GET /lead-sources?from&to&branch` · `GET /lead-sources/options` · `GET|POST /lead-sources/categories` · `POST/PUT/DELETE /lead-sources[/{id}]` · `GET|POST /lead-sources/{id}/integrations` · `PUT|DELETE /lead-sources/{id}/integrations/{mappingId}` · `GET /marketing/export?type=sources`.
