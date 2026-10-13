import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="login">
      <div className="empty">
        <h1>Not found</h1>
        <p>This page or container does not exist, or it was deleted.</p>
        <Link className="btn" href="/">
          Back to containers
        </Link>
      </div>
    </main>
  );
}
