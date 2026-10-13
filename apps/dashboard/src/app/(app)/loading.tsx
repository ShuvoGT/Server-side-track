import { Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      <Skeleton width={240} height={28} />
      <Skeleton width={360} />
      <div className="card card-body stack">
        <Skeleton height={20} />
        <Skeleton height={20} />
        <Skeleton height={20} />
      </div>
    </div>
  );
}
