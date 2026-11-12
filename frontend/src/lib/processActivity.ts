import type { ProcessActivity, ProcessData } from "../types";

export function processActivities(data: ProcessData): ProcessActivity[] {
  if (data.status !== "running") return [{ id: "completed", title: data.title, preview: "" }];
  if (data.activities?.length) return data.activities;
  return [{ id: "current", title: data.title, preview: data.preview || "" }];
}

export function nextProcessActivity(activities: ProcessActivity[], currentId: string | undefined): string | undefined {
  const index = activities.findIndex((activity) => activity.id === currentId);
  return activities[index < 0 ? 0 : Math.min(index + 1, activities.length - 1)]?.id;
}
