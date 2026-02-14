export type ComplianceStatus = 'pending' | 'compliant' | 'non_compliant' | 'partial' | 'not_applicable';

export interface ComplianceCheck {
  id: string;
  projectId: string;
  criterionName: string;
  requirementText?: string;
  complianceScore?: number;
  status: string;
  evidenceDocuments: EvidenceDocument[];
  assessorNotes?: string;
  assessedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceDocument {
  id: string;
  name: string;
  url?: string;
  uploadedAt: string;
}

export interface CreateComplianceCheckInput {
  criterionName: string;
  requirementText?: string;
  complianceScore?: number;
  status?: string;
  evidenceDocuments?: EvidenceDocument[];
  assessorNotes?: string;
}

export interface UpdateComplianceCheckInput {
  complianceScore?: number;
  status?: string;
  evidenceDocuments?: EvidenceDocument[];
  assessorNotes?: string;
}

export interface ComplianceOverview {
  totalChecks: number;
  averageScore: number;
  compliantCount: number;
  pendingCount: number;
  nonCompliantCount: number;
  checksByStatus: Record<string, number>;
}
