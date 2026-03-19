import { describe, it, expect } from 'vitest'

describe('New schema tables', () => {
  it('exports workflow_sessions table', async () => {
    const { workflowSessions } = await import('@/lib/db/schema')
    expect(workflowSessions).toBeDefined()
  })

  it('exports workflow_messages table', async () => {
    const { workflowMessages } = await import('@/lib/db/schema')
    expect(workflowMessages).toBeDefined()
  })

  it('exports discovered_calls table', async () => {
    const { discoveredCalls } = await import('@/lib/db/schema')
    expect(discoveredCalls).toBeDefined()
  })

  it('exports program_alerts table', async () => {
    const { programAlerts } = await import('@/lib/db/schema')
    expect(programAlerts).toBeDefined()
  })

  it('exports project_documents table', async () => {
    const { projectDocuments } = await import('@/lib/db/schema')
    expect(projectDocuments).toBeDefined()
  })

  it('exports project_files table', async () => {
    const { projectFiles } = await import('@/lib/db/schema')
    expect(projectFiles).toBeDefined()
  })

  it('exports team_members table', async () => {
    const { teamMembers } = await import('@/lib/db/schema')
    expect(teamMembers).toBeDefined()
  })
})
