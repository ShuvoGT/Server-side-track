import { Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      <div className="stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card stat stack" style={{ gap: 8 }}>
            <Skeleton width={90} height={12} />
            <Skeleton width={70} height={24} />
          </div>
        ))}
      </div>
      <div className="card card-body stack">
        <Skeleton height={18} />
        <Skeleton height={18} />
        <Skeleton height={18} width="60%" />
      </div>
    </div>
  );
}
