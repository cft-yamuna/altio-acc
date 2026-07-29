# Altio Reimbursement Workspace Overview

1. Altio Reimbursement is a standalone finance workspace for processing employee payroll reimbursement reports exported from RazorpayX.
2. It translates raw CSV expense records into double-entry accounting journals (Amount Receiver debit + Amount Payable credit) formatted for Zoho Books.
3. Users can review, renumber references/journals, retag expense purpose accounts, and assign project names across all reimbursement rows.
4. Supports two modes: one-off "Quick export" for instant conversion, and "Monthly collection" to aggregate and deduplicate claims throughout the month.
5. Built with React, Vite, TypeScript, and Supabase featuring strict Row-Level Security (RLS) and custom PDF/CSV export capabilities.

## Database SQL Architecture

1. The standalone SQL setup script creates dedicated database tables (`altio_reimbursement_exports`, `altio_reimbursement_pending`), an email allowlist RLS access function, and a private storage bucket (`altio-reimbursement-docs`).
2. It operates as a self-contained, isolated schema alongside existing accounting databases without modifying or interfering with any external CRM, finance, or master data objects.
