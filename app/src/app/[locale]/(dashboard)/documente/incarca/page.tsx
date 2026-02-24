import DocumentUpload from '@/components/ai/DocumentUpload';
import { PageHeader } from '@/components/ui/page-header';

export default function UploadDocumentPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents & Evidence"
        description="Upload and classify supporting files linked to milestones and reports."
      />
      <DocumentUpload />
    </div>
  );
}
