import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { employeeAPI } from '../services/api';
import type { EmployeeStats } from '../types';
import HeaderUser from './HeaderUser';
import AvatarUpload from '../components/AvatarUpload/AvatarUpload';
import TaskCommentsModal from '../components/TaskList/TaskCommentsModal';
import { safeHttpsUrl } from '../utils/safeUrl';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar
} from 'recharts';
import styles from './EmployeeProfilePage.module.css';

const priorityColors: Record<string, string> = {
  urgent: '#d62828',
  high: '#e07b39',
  medium: '#f4a261',
  low: '#8b6c3e',
};

const statusColors: Record<string, string> = {
  completed: '#2a9d8f',
  failed: '#e76f51',
  active: '#e9c46a',
  new: '#264653',
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className={styles.customTooltip}>
        <p className={styles.tooltipLabel}>{label}</p>
        <p className={styles.tooltipData}>{`${payload[0].value} Tasks`}</p>
      </div>
    );
  }
  return null;
};

const CustomPieTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className={styles.customTooltip}>
        <p className={styles.tooltipLabel} style={{ textTransform: 'capitalize' }}>{payload[0].name}</p>
        <p className={styles.tooltipData}>{`${payload[0].value} Tasks`}</p>
      </div>
    );
  }
  return null;
};

const EmployeeProfilePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { userData } = useAuth();
  const [stats, setStats] = useState<EmployeeStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [commentTaskId, setCommentTaskId] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setIsLoading(true);
        if (!id) return;
        const res = await employeeAPI.getStats(id);
        setStats(res.data.data);
      } catch (err: any) {
        console.error('Failed to fetch employee stats:', err);
        setError(err.response?.data?.error || 'Failed to load profile');
      } finally {
        setIsLoading(false);
      }
    };
    fetchStats();
  }, [id]);

  useGSAP(() => {
    if (!isLoading && stats && containerRef.current) {
      gsap.to(containerRef.current, {
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: 'power3.out',
      });
      
      gsap.from('.stagger-item', {
        y: 30,
        opacity: 0,
        duration: 0.6,
        stagger: 0.1,
        ease: 'back.out(1.2)',
        delay: 0.2
      });
    }
  }, [isLoading, stats]);

  if (isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div>
          <div className={styles.spinner}></div>
          <div className={styles.loadingText}>Loading Profile...</div>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className={styles.errorContainer}>
        <div className={styles.errorText}>{error || 'Profile not found'}</div>
        <button onClick={() => navigate(-1)} style={{ marginTop: '1rem', padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', backgroundColor: '#8b6c3e', color: 'white', cursor: 'pointer' }}>Go Back</button>
      </div>
    );
  }

  const { employee, monthlyTrend, priorityBreakdown, currentTasks } = stats;
  // Never render a non-https user-supplied URL as a link (blocks javascript: URLs)
  const linkedInHref = safeHttpsUrl(employee.linkedin_url);

  const pieData = [
    { name: 'completed', value: stats.completedTasks },
    { name: 'failed', value: stats.failedTasks },
    { name: 'active', value: stats.activeTasks },
    { name: 'new', value: stats.newTasks },
  ].filter(d => d.value > 0);

  const formattedTrend = monthlyTrend.length > 0 ? monthlyTrend : [{ month: 'No Data', count: 0 }];
  const formattedPriority = priorityBreakdown.length > 0 ? priorityBreakdown : [{ priority: 'none', count: 0 }];

  return (
    <>
      <HeaderUser data={userData ? { ...userData, data: { ...userData.data, first_name: userData.data.firstName || userData.data.first_name } } as any : null} />
      <div className={styles.container} ref={containerRef}>
        
        {/* Header */}
        <div className={`stagger-item ${styles.profileHeader}`}>
          <div className={styles.avatarWrap}>
            <AvatarUpload currentAvatarUrl={employee.avatar_url} name={employee.first_name || ''} size={100} readOnly />
          </div>
          <div className={styles.infoWrap}>
            <h1 className={styles.name}>{employee.first_name}</h1>
            <div className={styles.role}>{employee.designation || 'Employee'} • {employee.department || 'General'}</div>
            {employee.bio && <p className={styles.bio}>{employee.bio}</p>}
            <div className={styles.metaWrap}>
              <div className={styles.metaItem}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                {employee.email}
              </div>
              {employee.phone && (
                <div className={styles.metaItem}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                  {employee.phone}
                </div>
              )}
              {linkedInHref && (
                <div className={styles.metaItem}>
                  <a href={linkedInHref} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>
                    LinkedIn
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Metrics Row */}
        <div className={styles.metricsRow}>
          <div className={`stagger-item ${styles.metricCard}`}>
            <span className={styles.metricLabel}>Completion Rate</span>
            <span className={styles.metricValue}>{stats.completionRate}%</span>
          </div>
          <div className={`stagger-item ${styles.metricCard}`}>
            <span className={styles.metricLabel}>On-Time Rate</span>
            <span className={styles.metricValue}>{stats.onTimeRate}%</span>
          </div>
          <div className={`stagger-item ${styles.metricCard}`}>
            <span className={styles.metricLabel}>Tasks This Month</span>
            <span className={styles.metricValue}>{stats.tasksThisMonth}</span>
          </div>
          <div className={`stagger-item ${styles.metricCard}`}>
            <span className={styles.metricLabel}>Active Tasks</span>
            <span className={styles.metricValue}>{stats.activeTasks}</span>
          </div>
        </div>

        {/* Charts */}
        <div className={styles.chartsGrid}>
          <div className={`stagger-item ${styles.chartCard}`}>
            <h3 className={styles.chartTitle}>Completion Trend (Last 6 Months)</h3>
            <div className={styles.chartWrapper}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={formattedTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b6c3e" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#8b6c3e" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#ad9676', fontSize: 12, fontWeight: 600 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#ad9676', fontSize: 12, fontWeight: 600 }} />
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="count" stroke="#8b6c3e" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" activeDot={{ r: 6, fill: '#3b3123', stroke: '#fff', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className={`stagger-item ${styles.chartCard}`} style={{ flex: 1 }}>
              <h3 className={styles.chartTitle}>Task Status</h3>
              <div className={styles.chartWrapper}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={statusColors[entry.name] || '#8b6c3e'} />
                      ))}
                    </Pie>
                    <RechartsTooltip content={<CustomPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={`stagger-item ${styles.chartCard}`} style={{ flex: 1 }}>
              <h3 className={styles.chartTitle}>Priority Breakdown</h3>
              <div className={styles.chartWrapper}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={formattedPriority} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e0e0e0" />
                    <XAxis type="number" hide />
                    <YAxis dataKey="priority" type="category" axisLine={false} tickLine={false} tick={{ fill: '#ad9676', fontSize: 12, fontWeight: 700 }} width={70} />
                    <RechartsTooltip content={<CustomPieTooltip />} cursor={{ fill: '#f5f5f5' }} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20}>
                      {formattedPriority.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={priorityColors[entry.priority] || '#8b6c3e'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* Current Tasks List */}
        <div className={`stagger-item ${styles.tasksSection}`}>
          <h2 className={styles.tasksHeader}>Current Active Tasks</h2>
          <div className={styles.tasksList}>
            {currentTasks.length === 0 ? (
              <div className={styles.emptyTasks}>No active or new tasks at the moment.</div>
            ) : (
              currentTasks.map(task => (
                <div key={task.id} className={styles.taskItem}>
                  <div className={styles.taskLeft}>
                    <span className={styles.taskTitle}>{task.title}</span>
                    <span className={styles.priorityBadge} style={{ backgroundColor: priorityColors[task.priority] || '#8b6c3e' }}>{task.priority}</span>
                    <span className={styles.statusBadge}>{task.status}</span>
                    {task.is_overdue && <span className={styles.overdue}>OVERDUE</span>}
                  </div>
                  <div className={styles.taskRight}>
                    <span className={styles.dueDate}>{task.due_date ? new Date(task.due_date).toLocaleDateString() : ''}</span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setCommentTaskId(task.id); }}
                      style={{ background: '#ad9676', border: 'none', borderRadius: '8px', padding: '6px 12px', color: '#fff', cursor: 'pointer', display: 'flex', gap: '5px', alignItems: 'center', fontWeight: 'bold' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                      {task.comment_count || 0}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {commentTaskId !== null && (
        <TaskCommentsModal taskId={commentTaskId} isOpen={true} onClose={() => setCommentTaskId(null)} />
      )}
    </>
  );
};

export default EmployeeProfilePage;
