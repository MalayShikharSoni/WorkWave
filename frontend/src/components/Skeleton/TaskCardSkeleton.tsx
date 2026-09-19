import React, { memo } from 'react';
import Skeleton from './Skeleton';
import styles from './TaskCardSkeleton.module.css';

/**
 * Layout placeholder matching NewTask / AcceptedTask card geometry
 * (320×300, asymmetric 42px radii, top meta row + large title area).
 */
const TaskCardSkeleton = memo(() => {
  return (
    <div className={styles.card} aria-hidden="true">
      <div className={styles.topBar}>
        {/* category pill — TaskCard.category radii */}
        <Skeleton
          tone="onSurface"
          width={88}
          height={28}
          borderRadius="0 13px 13px 13px"
        />
        <div className={styles.badges}>
          <Skeleton tone="onSurface" width={52} height={24} borderRadius={9999} />
          <Skeleton tone="onSurface" width={28} height={24} borderRadius={9999} />
        </div>
        {/* due date */}
        <Skeleton tone="onSurface" width={72} height={22} borderRadius={8} />
      </div>

      <div className={styles.titleBlock}>
        {/* large title lines (~3rem title area) */}
        <Skeleton tone="onSurface" width="85%" height={40} borderRadius={10} />
        <Skeleton tone="onSurface" width="60%" height={40} borderRadius={10} />
      </div>

      <div className={styles.metaBlock}>
        <Skeleton tone="onSurface" width="90%" height={14} borderRadius={6} />
        <Skeleton tone="onSurface" width="70%" height={14} borderRadius={6} />
      </div>
    </div>
  );
});

TaskCardSkeleton.displayName = 'TaskCardSkeleton';
export default TaskCardSkeleton;
