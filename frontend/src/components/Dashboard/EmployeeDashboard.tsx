import React, { useContext, useEffect, useRef, useState, useCallback, memo } from "react";
import { Navigate } from "react-router-dom";
import TaskList from "../TaskList/TaskList";
import HeaderUser from "../../pages/HeaderUser";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { AuthContext, type AuthContextType } from "../../context/AuthProvider";
import { useSocket } from "../../context/SocketProvider";
import { taskAPI, invitationAPI, groupAPI } from "../../services/api";
import type { Task, TaskCounts, TaskStatus, Invitation, EmployeeGroupTasks } from "../../types";
import styles from "./EmployeeDashboard.module.css";

const emptyCounts = (): TaskCounts => ({ active: 0, new_task: 0, completed: 0, failed: 0 });

/** Derive category bubble counts from the single tasks array (status-filtered views). */
const countsFromTasks = (list: Task[]): TaskCounts =>
  list.reduce<TaskCounts>((acc, t) => {
    if (t.status === 'new') acc.new_task += 1;
    else if (t.status === 'active') acc.active += 1;
    else if (t.status === 'completed') acc.completed += 1;
    else if (t.status === 'failed') acc.failed += 1;
    return acc;
  }, emptyCounts());

const EmployeeDashboard = memo(() => {
  console.log('EmployeeDashboard RE-RENDERED');
  // One flat array; TaskList filters into New/Active/Completed/Failed by status.
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskCounts, setTaskCounts] = useState<TaskCounts>(emptyCounts());
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [error, setError] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [myGroups, setMyGroups] = useState<EmployeeGroupTasks[]>([]);
  const firstWaveRef = useRef<HTMLDivElement>(null);
  const thirdWaveRef = useRef<HTMLDivElement>(null);
  const { userData, isLoading: authLoading } = useContext(AuthContext) as AuthContextType;
  // socket: local optimistic updates for task events; refreshTrigger: invitations/groups only
  const { socket, refreshTrigger } = useSocket();
  const changeUser = useCallback(() => { }, []);

  const fetchMyTasks = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      // Full-page "Loading tasks" only on initial/explicit loads — never for socket safety-net refetches
      if (!opts?.silent) { setIsLoadingTasks(true); }
      setError("");
      const [tasksResponse, countsResponse] = await Promise.all([taskAPI.getMyTasks(), taskAPI.getMyTaskCounts()]);
      setTasks(tasksResponse.data.data); setTaskCounts(countsResponse.data.data);
      console.log("Tasks fetched:", tasksResponse.data.data);
      console.log("Task counts:", countsResponse.data.data);
    } catch (err) { console.error("Failed to fetch tasks:", err); setError("Failed to load tasks. Please refresh."); }
    finally { if (!opts?.silent) { setIsLoadingTasks(false); } }
  }, []);

  const refreshTasks = useCallback(() => { fetchMyTasks(); }, [fetchMyTasks]);

  // Initial fetch on mount/auth-ready only — task socket events update state locally (below).
  // Invitations/groups still use refreshTrigger (separate effect).
  useEffect(() => { if (userData && userData.role === 'employee') { fetchMyTasks(); } }, [userData, fetchMyTasks]);

  const fetchInvitations = useCallback(async () => {
    try { const res = await invitationAPI.getMyInvitations(); setInvitations(res.data.data); }
    catch (err) { console.error("Failed to fetch invitations:", err); }
  }, []);

  useEffect(() => { if (userData && userData.role === 'employee') { fetchInvitations(); fetchMyGroups(); } }, [userData, fetchInvitations, refreshTrigger]);

  // Keep a ref so socket handlers can decide refetch-vs-local without reading stale closures
  // or calling side effects inside a setState updater.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // Apply task:assigned / task:statusChanged locally — payload already has enough data; no full refetch.
  useEffect(() => {
    if (!socket || !userData || userData.role !== 'employee') return;

    const onTaskAssigned = (task: Task) => {
      setTasks(prev => {
        if (prev.some(t => t.id === task.id)) return prev;
        // Prepend so it appears at the start of the "New Tasks" filtered row
        const next = [{ ...task, status: (task.status || 'new') as TaskStatus }, ...prev];
        setTaskCounts(countsFromTasks(next));
        return next;
      });
    };

    const onTaskStatusChanged = ({ taskId, status }: { taskId: number; status: string }) => {
      // Not in local state yet (e.g. race with initial fetch) — silent full refetch as safety net
      if (!tasksRef.current.some(t => t.id === taskId)) {
        void fetchMyTasks({ silent: true });
        return;
      }
      // Same single array: update status in place; TaskList re-filters into the destination category
      setTasks(prev => {
        const next = prev.map(t =>
          t.id === taskId ? { ...t, status: status as TaskStatus } : t
        );
        setTaskCounts(countsFromTasks(next));
        return next;
      });
    };

    socket.on('task:assigned', onTaskAssigned);
    socket.on('task:statusChanged', onTaskStatusChanged);
    return () => {
      socket.off('task:assigned', onTaskAssigned);
      socket.off('task:statusChanged', onTaskStatusChanged);
    };
  }, [socket, userData, fetchMyTasks]);

  const fetchMyGroups = async () => {
    try {
      const res = await groupAPI.getMyGroupTasks();
      setMyGroups(res.data.data);
    } catch (err) { console.error('Failed to fetch group tasks:', err); }
  };

  const handleRespondInvitation = async (invitationId: number, status: string) => {
    setInvitationLoading(true);
    try {
      await invitationAPI.respondToInvitation(invitationId, status);
      await fetchInvitations();
      if (status === 'accepted') { alert('You have joined the team!'); }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      alert(e.response?.data?.error || `Failed to ${status} invitation`);
    } finally { setInvitationLoading(false); }
  };

  useGSAP(() => {
    if (!firstWaveRef.current || !thirdWaveRef.current) return;
    gsap.fromTo(firstWaveRef.current, { x: 0 }, { x: "-40vw", ease: "none", scrollTrigger: { trigger: ".employeeDashboard", start: "top top", end: "bottom top", scrub: 1 } });
    gsap.fromTo(thirdWaveRef.current, { x: 0 }, { x: "42.5vw", ease: "none", scrollTrigger: { trigger: ".employeeDashboard", start: "top top", end: "bottom top", scrub: 1, markers: false } });
  }, []);

  if (authLoading) {
    return (<div className={styles.loadingContainer}><div className={styles.loadingContent}>
      <div className={styles.spinner}></div>
      <p className={styles.loadingText}>Checking authentication...</p></div></div>);
  }
  if (!userData || userData.role !== 'employee') { return <Navigate to="/login" replace />; }

  return (
    <div className={styles.wrapper}>
      <HeaderUser ref={{ firstWaveRef, thirdWaveRef } as unknown as React.Ref<unknown>} changeUser={changeUser} data={userData?.data} user={userData?.data?.email} />
      <div className={`employeeDashboard ${styles.dashboard}`}>
        {error && (
          <div className={styles.errorBox}>
            <span>{error}</span>
            <button onClick={() => fetchMyTasks()} className={styles.retryBtn}>Retry</button>
          </div>
        )}
        {invitations.length > 0 && (
          <div className={styles.invitationsSection}>
            <div className={styles.invitationsTitle}>Team Invitations</div>
            <div className={styles.invitationsList}>
              {invitations.map((inv) => (
                <div key={inv.id} className={styles.invitationCard}>
                  <div className={styles.invitationInfo}>
                    <span className={styles.invitationName}>{inv.admin_name}</span>
                    <span className={styles.invitationText}>wants you to join their team</span>
                  </div>
                  <div className={styles.invitationActions}>
                    <button onClick={() => handleRespondInvitation(inv.id, 'accepted')} disabled={invitationLoading}
                      className={styles.acceptBtn}>Accept</button>
                    <button onClick={() => handleRespondInvitation(inv.id, 'rejected')} disabled={invitationLoading}
                      className={styles.declineBtn}>Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <TaskList
          tasks={tasks}
          taskCounts={taskCounts}
          refreshTasks={refreshTasks}
          data={userData?.data}
          isLoading={isLoadingTasks}
        />

        {/* My Groups Section */}
        {myGroups.length > 0 && (
          <div className={styles.invitationsSection} style={{ marginTop: '2rem' }}>
            <div className={styles.invitationsTitle}>My Project Groups</div>
            {myGroups.map(group => (
              <div key={group.group_id} style={{ marginBottom: '1.5rem' }}>
                <div 
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: '8px' }}
                  onClick={() => window.location.href = `/groups/${group.group_id}`}
                >
                  <span style={{ fontWeight: 900, fontSize: '1.2rem', color: '#3b3123' }}>{group.group_name}</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#ad9676', textDecoration: 'underline' }}>View Details</span>
                </div>
                {group.tasks.length === 0 ? (
                  <div style={{ color: '#ad9676', fontWeight: 700, fontSize: '0.95rem' }}>No active tasks in this group.</div>
                ) : (
                  group.tasks.map(task => (
                    <div key={task.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', backgroundColor: '#cec0ad', borderRadius: '10px', marginBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, color: '#3b3123' }}>{task.title}</span>
                        <span style={{ padding: '2px 10px', borderRadius: '12px', fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase', color: '#fff', backgroundColor: task.priority === 'urgent' ? '#d62828' : task.priority === 'high' ? '#e07b39' : task.priority === 'medium' ? '#f4a261' : '#8b6c3e' }}>{task.priority}</span>
                        <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#8b6c3e', textTransform: 'uppercase' }}>{task.status}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {task.due_date && <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#8b6c3e' }}>{new Date(task.due_date).toLocaleDateString()}</span>}
                        {task.status === 'new' && (
                          <button onClick={async (e) => { e.stopPropagation(); await groupAPI.updateTaskStatus(group.group_id, task.id, 'active'); fetchMyGroups(); }} style={{ background: '#2a9d8f', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: '8px', fontWeight: 800, cursor: 'pointer', fontSize: '0.8rem' }}>Accept</button>
                        )}
                        {task.status === 'active' && (
                          <button onClick={async (e) => { e.stopPropagation(); await groupAPI.updateTaskStatus(group.group_id, task.id, 'completed'); fetchMyGroups(); }} style={{ background: '#2a9d8f', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: '8px', fontWeight: 800, cursor: 'pointer', fontSize: '0.8rem' }}>Complete</button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

EmployeeDashboard.displayName = 'EmployeeDashboard';
export default EmployeeDashboard;
