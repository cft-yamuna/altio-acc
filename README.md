# Altio Reimbursement

A completely standalone reimbursement workspace. It includes:

- Google sign-in with a fixed seven-email allowlist
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

The browser allowlist is in `src/auth/AuthProvider.tsx`; the matching database allowlist is in `supabase/26.07.29-12.53-altio-reimbursement-setup.sql`. Keep them identical.

