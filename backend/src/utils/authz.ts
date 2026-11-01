// src/utils/authz.ts
// Shared ownership checks. A role check alone ("is an admin") is never enough:
// every resource must also belong to the requester.

interface TaskOwnership {
  created_by: number;
  assigned_to: number;
}

// A task is visible only to the admin who created it and the employee it is
// assigned to.
export function canAccessTask(task: TaskOwnership, userId: number): boolean {
  return task.created_by === userId || task.assigned_to === userId;
}
