export type RiskLevel = 'very_low' | 'low' | 'medium' | 'high' | 'very_high';

export interface TimelineItem {
  id: string;
  projectId: string;
  workPackageId?: string | null;
  taskName: string;
  startDate: string;
  endDate: string;
  dependencies: string[];
  progressPercentage: number;
  assignedTo?: string | null;
  riskLevel: RiskLevel;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTimelineInput {
  workPackageId?: string;
  taskName: string;
  startDate: string;
  endDate: string;
  dependencies?: string[];
  progressPercentage?: number;
  assignedTo?: string;
  riskLevel?: RiskLevel;
}

export interface GanttData {
  workPackages: Array<{
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
    tasks: TimelineItem[];
  }>;
  projectStartDate: string;
  projectEndDate: string;
  totalProgress: number;
}
