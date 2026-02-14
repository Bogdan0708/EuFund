export type WorkPackageStatus = 'planned' | 'active' | 'completed' | 'delayed' | 'cancelled';

export interface Milestone {
  id: string;
  name: string;
  dueDate: string;
  completed: boolean;
  description?: string;
}

export interface Deliverable {
  id: string;
  name: string;
  type: string;
  dueDate: string;
  completed: boolean;
  description?: string;
}

export interface WorkPackage {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  budgetAllocated?: number;
  budgetSpent: number;
  status: WorkPackageStatus;
  leadPartnerId?: string;
  dependencies: string[];
  milestones: Milestone[];
  deliverables: Deliverable[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkPackageInput {
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  budgetAllocated?: number;
  status?: WorkPackageStatus;
  leadPartnerId?: string;
  dependencies?: string[];
  milestones?: Milestone[];
  deliverables?: Deliverable[];
}

export interface UpdateWorkPackageInput {
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  budgetAllocated?: number;
  budgetSpent?: number;
  status?: WorkPackageStatus;
  leadPartnerId?: string;
  dependencies?: string[];
  milestones?: Milestone[];
  deliverables?: Deliverable[];
}
