# Altio Reimbursement

A completely standalone reimbursement workspace. It includes:

- Google sign-in for @craftech360.com accounts, with three roles (below)
- employee reimbursement requests with bill uploads, and admin approve / reject
- quick CSV import, editable reference/journal/project/purpose fields, and Zoho Books CSV export
- direct PDF export
- saved export history with re-download, edit, overwrite, and delete
- monthly collection, upload batches, duplicate detection, combined export, and month clearing

## Local setup

1. Create a new Supabase project dedicated only to Altio Reimbursement.
2. Run [`supabase/26.07.29-12.53-altio-reimbursement-setup.sql`](supabase/26.07.29-12.53-altio-reimbursement-setup.sql) in that new project's SQL Editor.
3. Copy `.env.example` to `.env` and fill in all three values from the new project:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_SUPABASE_PROJECT_REF` — the first part of the URL, before `.supabase.co`
4. Run `npm install`.
5. Run `npm run dev`.

Never add a Supabase service-role key or database password to a Vite environment file.

The app validates that `VITE_SUPABASE_PROJECT_REF` matches the configured URL. It will refuse to start when the values do not match, preventing accidental use of another project.

## Standalone data

The setup SQL creates only:

- `altio_reimbursement_exports`
- `altio_reimbursement_pending`
- private `altio-reimbursement-docs` storage bucket
- `altio_reimbursement_is_allowed()` access function and RLS policies

The application does not query accounting, CRM, finance, project, expense-account, employee, or master-data tables/views. Project and Purpose are manually typed values saved only with reimbursement records.

In Supabase Dashboard:

1. Open **Authentication → Providers → Google** and enable Google using your Google OAuth client ID and secret.
2. Use a Google OAuth client dedicated to this Altio application and add the Supabase callback URL shown on the provider screen to its authorized redirect URIs.
3. Under **Authentication → URL Configuration**, set the production Site URL and add local/production redirect URLs, including `http://localhost:5175`.

## Roles

| Role | Who | Can |
|---|---|---|
| Employee | any `@craftech360.com` Google account | submit requests with bills and a reason, see their own requests, withdraw while pending |
| Admin | `ADMIN_EMAILS` | see every request and its bills, approve, or reject with a reason; never their own request |
| Accounts | `REIMBURSEMENT_EMAILS` | the Zoho export workspace (quick export + monthly collection) |

The lists live in `src/auth/AuthProvider.tsx` and are enforced again in the database:

- accounts list: `altio_reimbursement_is_allowed()` in `supabase/26.07.29-17.03-altio-reimbursement-setup.sql`
- admin list: `altio_reimbursement_is_admin()` in `supabase/26.11.26-17.30-altio-reimbursement-requests.sql`

Keep each pair identical. After changing a list, re-run that function's SQL in Supabase.

## Employee requests setup

Run `supabase/26.11.26-17.30-altio-reimbursement-requests.sql` in the SQL Editor of the same Supabase project, after the setup SQL. It adds the `altio_reimbursement_requests` table, its security rules, and storage rules for bills under `altio-reimbursement-docs/requests/<user id>/`.

