export type RiskStatus = 'identified' | 'analyzing' | 'mitigating' | 'resolved' | 'accepted';

export interface RiskAssessment {
  id: string;
  projectId: string;
  riskType: string;
  description?: string;
  probability: number;
  impact: number;
  riskScore: number; // computed: probability * impact
  mitigationStrategy?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRiskInput {
  riskType: string;
  description?: string;
  probability: number;
  impact: number;
  mitigationStrategy?: string;
  status?: string;
}

export interface UpdateRiskInput {
  riskType?: string;
  description?: string;
  probability?: number;
  impact?: number;
  mitigationStrategy?: string;
  status?: string;
}

export interface RiskOverview {
  totalRisks: number;
  highRisks: number;
  averageRiskScore: number;
  risksByType: Record<string, number>;
  risksByStatus: Record<string, number>;
}
