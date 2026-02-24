import DocumentUpload from '@/components/ai/DocumentUpload';
import { PageHeader } from '@/components/ui/page-header';

export default function UploadDocumentPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Documente și dovezi"
        description="Încarcă și clasifică fișiere justificative legate de jaloane și rapoarte."
      />
      <DocumentUpload />
    </div>
  );
}
