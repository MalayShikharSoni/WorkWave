import React, { useRef, memo } from "react";
import AcceptedTask from "./AcceptedTask";
import NewTask from "./NewTask";
import CompletedTask from "./CompletedTask";
import FailedTask from "./FailedTask";
import TaskCardSkeleton from "../Skeleton/TaskCardSkeleton";
import Skeleton from "../Skeleton/Skeleton";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { Task, TaskCounts, User } from "../../types";
import styles from "./TaskList.module.css";

interface TaskListProps {
  tasks?: Task[];
  taskCounts?: TaskCounts;
  refreshTasks?: () => void;
  data?: User;
  /** Initial fetch — show card skeletons instead of empty categories / parent spinner. */
  isLoading?: boolean;
}

const TaskList = memo<TaskListProps>(({ tasks = [], taskCounts = {} as TaskCounts, refreshTasks, isLoading = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimatedRef = useRef(false);
  
  const newTasks = tasks.filter(task => task.status === 'new');
  const activeTasks = tasks.filter(task => task.status === 'active');
  const completedTasks = tasks.filter(task => task.status === 'completed');
  const failedTasks = tasks.filter(task => task.status === 'failed');

  useGSAP(() => {
    if (isLoading || hasAnimatedRef.current || !containerRef.current) return;
    hasAnimatedRef.current = true;
    const ctx = gsap.context(() => {
      const tl1 = gsap.timeline();
      const tl2 = gsap.timeline();
      tl1.to(".popupBubble3", { duration: 0.6, scale: 1.2, yoyo: true, repeat: -1 });
      tl1.to(".popupBubble2", { duration: 0.6, scale: 1.2, delay: 0.3, yoyo: true, repeat: -1 });
      tl1.to(".popupBubble1", { duration: 0.6, scale: 1.2, delay: 0.3, yoyo: true, repeat: -1 });
      tl2.to(".popupBubble", { duration: 3, opacity: 0, repeat: -1, yoyo: true, delay: 4.2 });
      tl1.to(".popupText", { duration: 3, delay: 2, opacity: 1, repeat: -1, yoyo: true });
      gsap.from(".taskNumberBubble", { scale: 0, duration: 0.6, translateX: "-145px", translateY: "-50px", stagger: 0.1 });
    }, containerRef);
    return () => ctx.revert();
  }, [isLoading]);

  const EmptyState = () => (
    <div className={styles.emptyState}>
      <div className={styles.emptyBox}>
        <div className={`popupBubble ${styles.bubbleWrap}`}>
          <div className={`popupBubble1 ${styles.bubble}`}></div>
          <div className={`popupBubble2 ${styles.bubble}`}></div>
          <div className={`popupBubble3 ${styles.bubble}`}></div>
        </div>
        <div className={`popupText ${styles.emptyText}`}>
          No Such Tasks
        </div>
      </div>
    </div>
  );

  const TaskCountBubble: React.FC<{ count: number; label: string }> = ({ count, label }) => (
    <div className={`taskNumberBubble ${styles.countBubble}`}>
      <span className={styles.countNumber}>{count ?? 0}</span>
      <span className={styles.countLabel}>{label}</span>
    </div>
  );

  const TaskRow: React.FC<React.PropsWithChildren> = ({ children }) => (
    <div className={styles.taskRow}>
      {children}
    </div>
  );

  if (isLoading) {
    return (
      <div
        ref={containerRef}
        className={styles.container}
        role="status"
        aria-busy="true"
        aria-label="Loading tasks"
      >
        {/* Count bubble placeholder — matches .countBubble 290×100 / 35px radii */}
        <Skeleton
          tone="surface"
          width={290}
          height={100}
          borderRadius="0 35px 35px 35px"
        />
        <TaskRow>
          <TaskCardSkeleton />
          <TaskCardSkeleton />
          <TaskCardSkeleton />
          <TaskCardSkeleton />
        </TaskRow>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={styles.container}>
      <TaskCountBubble count={taskCounts.new_task} label="New Tasks" />
      <TaskRow>
        {newTasks.length > 0 ? newTasks.map((task) => (<NewTask key={task.id} data={task} refreshTasks={refreshTasks} />)) : <EmptyState />}
      </TaskRow>
      <TaskCountBubble count={taskCounts.active} label="Active Tasks" />
      <TaskRow>
        {activeTasks.length > 0 ? activeTasks.map((task) => (<AcceptedTask key={task.id} data={task} refreshTasks={refreshTasks} />)) : <EmptyState />}
      </TaskRow>
      <TaskCountBubble count={taskCounts.completed} label="Completed Tasks" />
      <TaskRow>
        {completedTasks.length > 0 ? completedTasks.map((task) => (<CompletedTask key={task.id} data={task} />)) : <EmptyState />}
      </TaskRow>
      <TaskCountBubble count={taskCounts.failed} label="Failed Tasks" />
      <TaskRow>
        {failedTasks.length > 0 ? failedTasks.map((task) => (<FailedTask key={task.id} data={task} />)) : <EmptyState />}
      </TaskRow>
    </div>
  );
});

TaskList.displayName = 'TaskList';
export default TaskList;
