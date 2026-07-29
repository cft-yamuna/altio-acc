export interface Database {
  public: {
    Tables: {
      altio_reimbursement_exports: {
        Row: {
          id: string;
          created_at: string;
          filename: string;
          row_count: number;
          storage_path: string;
          created_by: string | null;
        };
      };
      altio_reimbursement_pending: {
        Row: {
          id: string;
          month: string;
          entry_date: string;
          name: string;
          type: string;
          details: string;
          amount: number;
          status: string;
          approved_on: string;
          source_file: string;
          dup_key: string;
          created_at: string;
          created_by: string | null;
          batch_id: string | null;
          project: string;
          account: string;
          seq: number;
        };
      };
    };
  };
}
