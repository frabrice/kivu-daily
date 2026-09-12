import { useEffect, useState, useCallback } from 'react';
import { supabase, Profile, Task, Department } from './supabase';
import { todayStr, dateStr } from './utils';

export interface EmployeeWithStats extends Profile {
  todayTasks: Task[];
  todayPct: number;
  todayCompleted: number;
  todayTotal: number;
  streak: number;
}

export function useCompanyData() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [pRes, dRes, tRes] = await Promise.all([
      supabase.from('profiles').select('*, department:departments(*)').eq('is_active', true),
      supabase.from('departments').select('*').order('name'),
      supabase.from('tasks').select('*'),
    ]);
    setProfiles((pRes.data as Profile[]) ?? []);
    setDepartments((dRes.data as Department[]) ?? []);
    setAllTasks((tRes.data as Task[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('company-tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return { profiles, departments, allTasks, loading, reload: load };
}

export function computeStreakForTasks(tasks: Task[]): number {
  const completedDates = new Set(tasks.filter((t) => t.completed).map((t) => t.date));
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!completedDates.has(dateStr(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!completedDates.has(dateStr(cursor))) return 0;
  }
  while (completedDates.has(dateStr(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function buildEmployeeStats(profile: Profile, allTasks: Task[]): EmployeeWithStats {
  const userTasks = allTasks.filter((t) => t.user_id === profile.id);
  const today = todayStr();
  const todayTasks = userTasks.filter((t) => t.date === today);
  const todayCompleted = todayTasks.filter((t) => t.completed).length;
  const todayTotal = todayTasks.length;
  const todayPct = todayTotal === 0 ? 0 : (todayCompleted / todayTotal) * 100;
  const streak = computeStreakForTasks(userTasks);
  return { ...profile, todayTasks, todayPct, todayCompleted, todayTotal, streak };
}

export function departmentStats(deptId: string, employees: EmployeeWithStats[]) {
  const deptEmployees = employees.filter((e) => e.department_id === deptId);
  const activeToday = deptEmployees.filter((e) => e.todayTotal > 0);
  const totalTasks = deptEmployees.reduce((s, e) => s + e.todayTotal, 0);
  const completedTasks = deptEmployees.reduce((s, e) => s + e.todayCompleted, 0);
  const pct = totalTasks === 0 ? 0 : (completedTasks / totalTasks) * 100;
  return { deptEmployees, activeToday: activeToday.length, totalTasks, completedTasks, pct };
}
